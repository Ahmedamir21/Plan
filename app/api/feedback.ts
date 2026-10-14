import { createHmac, randomUUID } from 'node:crypto';
import { redis, storageConfigured } from '../server/admin-store';
import { jsonRequest, sameOrigin } from '../server/security';

export const FEEDBACK_IDS = 'planora:feedback:ids:v1';
export const FEEDBACK_DATA = 'planora:feedback:data:v1';
export const FEEDBACK_CATEGORIES = ['Overall experience', 'Ease of use', 'Schedule generator', 'AI assistant', 'Design & mobile', 'Feature idea', 'Other'] as const;
const SAVE = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
if n > 3 then return 0 end
if redis.call('LLEN', KEYS[2]) >= 500 then return -1 end
redis.call('HSET', KEYS[3], ARGV[1], ARGV[2])
redis.call('LPUSH', KEYS[2], ARGV[1])
return 1`;

export type Feedback = {
  id: string; at: string; category: typeof FEEDBACK_CATEGORIES[number]; rating: number | null;
  message: string; reporterName?: string; status: 'new' | 'reviewed' | 'archived'; note?: string; reviewedBy?: string; reviewedAt?: string;
};

export function feedbackSummary(items: Feedback[]) {
  const categories = Object.fromEntries(FEEDBACK_CATEGORIES.map(name => [name, items.filter(item => item.category === name).length]));
  const rated = items.filter(item => item.rating !== null);
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return {
    total: items.length,
    newCount: items.filter(item => item.status === 'new').length,
    last7Days: items.filter(item => Date.parse(item.at) >= since).length,
    averageRating: rated.length ? Math.round(rated.reduce((sum, item) => sum + item.rating!, 0) / rated.length * 10) / 10 : null,
    ratingCount: rated.length,
    categories,
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, private'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid origin.' });
  if (!jsonRequest(req, 4_000)) return res.status(413).json({ error: 'Invalid or oversized JSON request.' });
  if (!storageConfigured()) return res.status(503).json({ error: 'Feedback is temporarily unavailable. Please try again later.' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (!FEEDBACK_CATEGORIES.includes(body.category) || typeof body.message !== 'string' || body.message.length > 1200 || (body.reporterName !== undefined && (typeof body.reporterName !== 'string' || body.reporterName.length > 60)) || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 10) return res.status(400).json({ error: 'Choose a rating from 1 to 10. Name and comments can be left blank.' });
  const item: Feedback = { id: randomUUID(), at: new Date().toISOString(), category: body.category, rating: body.rating, message: body.message.trim(), reporterName: body.reporterName?.trim() || undefined, status: 'new' };
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const bucket = createHmac('sha256', process.env.PLANORA_ADMIN_SESSION_SECRET || '').update(ip).digest('hex');
    const saved = await redis(['EVAL', SAVE, 3, `planora:feedback:limit:${bucket}`, FEEDBACK_IDS, FEEDBACK_DATA, item.id, JSON.stringify(item)]);
    if (saved === 0) return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
    if (saved !== 1) return res.status(503).json({ error: 'The feedback inbox is full. Please try again later.' });
    return res.status(201).json({ id: item.id });
  } catch {
    console.error('Feedback storage failed.');
    return res.status(503).json({ error: 'Feedback was not delivered. Please try again later.' });
  }
}

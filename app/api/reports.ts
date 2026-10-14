import { createHmac, randomUUID } from 'node:crypto';
import { redis, storageConfigured } from '../server/admin-store';
import { notifyAdmins } from '../server/report-email';
import { jsonRequest, sameOrigin } from '../server/security';

export const REPORTS_KEY = 'planora:reports:ids:v1';
export const REPORTS_DATA = 'planora:reports:data:v1';
const TYPES = ['Course name', 'Instructor name', 'Day or time', 'Room', 'Section', 'Credits', 'Other'];
const CREATE = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
if n > 5 then return 0 end
if redis.call('LLEN', KEYS[2]) >= 500 then return -1 end
redis.call('HSET', KEYS[3], ARGV[1], ARGV[2])
redis.call('LPUSH', KEYS[2], ARGV[1])
return 1`;

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid origin.' });
  if (!jsonRequest(req, 8_000)) return res.status(413).json({ error: 'Invalid or oversized JSON request.' });
  if (!storageConfigured()) return res.status(503).json({ error: 'Reports are temporarily unavailable. Please try again later.' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const fields = ['courseCode', 'component', 'section', 'details', 'publishedData'];
  if (body.reporterName !== undefined && (typeof body.reporterName !== 'string' || body.reporterName.length > 60)) return res.status(400).json({ error: 'Reporter name is too long.' });
  if (fields.some(field => typeof body[field] !== 'string') || !Array.isArray(body.types) || body.types.length < 1 || body.types.length > TYPES.length || body.types.some((type: unknown) => !TYPES.includes(type as string))) return res.status(400).json({ error: 'Please select the problem and describe it.' });
  const report = {
    id: randomUUID(), at: new Date().toISOString(), status: 'new', types: [...new Set<string>(body.types)],
    courseCode: body.courseCode.trim().slice(0, 80), component: body.component.trim().slice(0, 30),
    section: body.section.trim().slice(0, 40), details: body.details.trim().slice(0, 1500),
    publishedData: body.publishedData.trim().slice(0, 3000),
    reporterName: (body.reporterName || '').trim(),
  };
  if (!report.details || body.details.length > 1500 || body.publishedData.length > 3000 || body.courseCode.length > 80 || body.section.length > 40 || !['', 'Lecture', 'Lab', 'Tutorial'].includes(report.component)) return res.status(400).json({ error: 'Report details are missing or too long.' });
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const secret = process.env.PLANORA_ADMIN_SESSION_SECRET || '';
    const bucket = createHmac('sha256', secret).update(ip).digest('hex');
    const saved = await redis(['EVAL', CREATE, 3, `planora:reports:limit:${bucket}`, REPORTS_KEY, REPORTS_DATA, report.id, JSON.stringify(report)]);
    if (saved === 0) return res.status(429).json({ error: 'Too many reports. Please try again later.' });
    if (saved !== 1) return res.status(503).json({ error: 'The inbox is full. Please try again later.' });
    await notifyAdmins(report);
    return res.status(201).json({ id: report.id });
  } catch {
    console.error('Report storage failed.');
    return res.status(503).json({ error: 'Report could not be delivered. Please try again later.' });
  }
}

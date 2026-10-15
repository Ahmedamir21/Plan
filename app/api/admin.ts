import { createHash, createHmac, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { HISTORY_KEY, rateLimited, redis, storageConfigured } from '../server/admin-store.js';
import { jsonRequest, sameOrigin } from '../server/security.js';
import { ADMIN_ACCOUNTS } from '../admin-accounts.js';
import { REPORTS_DATA, REPORTS_KEY } from './reports.js';
import { REPORT_EMAIL_STATUS } from '../server/report-email.js';
import { FEEDBACK_DATA, FEEDBACK_IDS, feedbackSummary, type Feedback } from './feedback.js';
import { SECURITY_KEY, clientIp, securityEmail, securityEvent } from '../server/admin-security.js';
import { adminCatalog, academicHistory } from '../server/admin-catalog.js';

const COOKIE = 'planora_admin';
const UPDATE_REPORT = `local old = redis.call('HGET', KEYS[1], ARGV[1])
if not old or old ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('LPUSH', KEYS[2], ARGV[4])
return 1`;

type Admin = { id: 'ahmed' | 'youssef'; username: string; name: string; hash: string };
function configured() {
  const secret = process.env.PLANORA_ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32 || !storageConfigured()) return null;
  const admins: Admin[] = ADMIN_ACCOUNTS.map(account => ({
    id: account.id, username: account.username, name: account.name,
    hash: process.env[account.passwordHashEnv] || '',
  }));
  if (admins.some(admin => !admin.username || !admin.hash)) return null;
  if (admins[0].username === admins[1].username) return null;
  return { admins, secret };
}
function equal(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function verifyPassword(password: string, hashSpec: string) {
  const [salt, hash, extra] = hashSpec.split(':');
  if (!salt || !hash || extra || !/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(hash) || password.length > 256) return false;
  return equal(scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex'), hash);
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const sign = (value: string, secret: string) => createHmac('sha256', secret).update(value).digest('base64url');
function cookie(value: string, age: number) { return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`; }
function session(req: any, config: NonNullable<ReturnType<typeof configured>>) {
  const value = String(req.headers.cookie || '').split(';').map((part: string) => part.trim()).find((part: string) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra || !equal(signature, sign(payload, config.secret))) return null;
  try {
    const token = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(token.exp) && token.exp > Date.now() ? config.admins.find(a => a.id === token.id && token.credentialVersion === sha(a.hash)) || null : null;
  } catch { return null; }
}
function event(admin: Admin, action: string, options: Record<string, unknown> = {}) {
  return JSON.stringify({ id: randomUUID(), at: new Date().toISOString(), adminId: admin.id, adminName: admin.name, action, ...options });
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store, private'); res.setHeader('X-Content-Type-Options', 'nosniff');
  const config = configured();
  if (!config) return res.status(503).json({ error: 'Configure the server-side admin password hashes, session secret, and a dedicated Redis store for this deployment.' });
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ error: 'Invalid origin' });
  if (req.method === 'POST' && !jsonRequest(req, 300_000)) return res.status(413).json({ error: 'Invalid or oversized JSON request.' });
  const admin = session(req, config);
  if (req.method === 'GET' && !admin) return res.status(req.query?.action ? 401 : 200).json({ authenticated: false, ...(req.query?.action ? {error:'Sign in again.'}: {}) });
  try {
    if (req.method === 'GET') {
      const action = req.query?.action;
      if (await adminCatalog(req,res,admin!)) return;
      if (action === 'reports') {
        const rawIds = await redis(['LRANGE', REPORTS_KEY, 0, 499]);
        const rows = rawIds?.length ? await redis(['HMGET', REPORTS_DATA, ...rawIds]) : [];
        const emailStatuses = rawIds?.length ? await redis(['HMGET', REPORT_EMAIL_STATUS, ...rawIds]) : [];
        const reports = (rows || []).map((row: string | null, index: number) => row ? { ...JSON.parse(row), emailStatus: emailStatuses?.[index] || 'not configured' } : null).filter(Boolean);
        return res.status(200).json({ reports, newCount: reports.filter((item: any) => item.status === 'new').length });
      }
      if (action === 'feedback') {
        const ids = await redis(['LRANGE', FEEDBACK_IDS, 0, 499]);
        const raw = ids?.length ? await redis(['HMGET', FEEDBACK_DATA, ...ids]) : [];
        const items: Feedback[] = (raw || []).filter(Boolean).map((row: string) => JSON.parse(row));
        return res.status(200).json({ items, summary: feedbackSummary(items) });
      }
      if (action === 'history') {
        const page = Math.min(100, Math.max(0, Number(req.query?.page) || 0));
        const raw = await redis(['LRANGE', HISTORY_KEY, 0, (page + 1) * 20 - 1]);
        const entries = [...(raw || []).map((row: string) => JSON.parse(row)),...await academicHistory((page+1)*20)];
        entries.sort((a,b) => String(b.at).localeCompare(String(a.at)));
        return res.status(200).json({ entries: entries.slice(page*20,page*20+20) });
      }
      if (action === 'security') {
        const raw = await redis(['LRANGE', SECURITY_KEY, 0, 199]);
        return res.status(200).json({ entries: (raw || []).map((row: string) => JSON.parse(row)) });
      }
      return res.status(200).json({ authenticated: true, user: { id: admin!.id, name: admin!.name } });
    }
    if (req.method === 'DELETE') {
      if (admin) await redis(['LPUSH', HISTORY_KEY, event(admin, 'logout')]);
      res.setHeader('Set-Cookie', cookie('', 0));
      return res.status(200).json({ authenticated: false });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.action === 'login') {
      const username = typeof body.username === 'string' ? body.username : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const ip = clientIp(req);
      if (await rateLimited('admin-login', ip, 5, 15 * 60, config.secret)) {
        const blocked = await securityEvent(req, 'login_blocked', username);
        if (!(await rateLimited('admin-alert-blocked', ip, 1, 15 * 60, config.secret))) await securityEmail(blocked);
        return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      }
      const candidate = config.admins.find(a => equal(a.username, username));
      if (!candidate || !verifyPassword(password, candidate.hash)) {
        await securityEvent(req, 'login_failure', username);
        return res.status(401).json({ error: 'Incorrect username or password.' });
      }
      const signIn = await securityEvent(req, 'login_success', username, candidate.name);
      await redis(['LPUSH', HISTORY_KEY, event(candidate, 'login')]);
      const age = 8 * 60 * 60;
      const payload = Buffer.from(JSON.stringify({ id: candidate.id, credentialVersion:sha(candidate.hash), exp: Date.now() + age * 1000 })).toString('base64url');
      res.setHeader('Set-Cookie', cookie(`${payload}.${sign(payload, config.secret)}`, age));
      await securityEmail(signIn);
      return res.status(200).json({ authenticated: true, user: { id: candidate.id, name: candidate.name } });
    }
    if (!admin) return res.status(401).json({ error: 'Sign in again.' });
    if (await rateLimited('admin-writes',admin.id,60,60,config.secret)) return res.status(429).json({ error:'Too many changes. Wait a minute.' });
    if (body.action === 'sync_start' && await rateLimited('admin-sync',admin.id,4,3600,config.secret)) return res.status(429).json({ error:'Sync rate limit reached. Review history before retrying.' });
    if (await adminCatalog(req,res,admin)) return;
    if (body.action === 'review_feedback') {
      if (typeof body.id !== 'string' || !/^[\da-f-]{36}$/i.test(body.id) || !['reviewed', 'archived', 'new'].includes(body.status) || typeof body.note !== 'string' || !body.note.trim() || body.note.length > 500) return res.status(400).json({ error: 'Choose a status and add a review note.' });
      const previous = await redis(['HGET', FEEDBACK_DATA, body.id]);
      if (!previous) return res.status(404).json({ error: 'Feedback not found.' });
      const item = JSON.parse(previous);
      const updated = { ...item, status: body.status, note: body.note.trim(), reviewedAt: new Date().toISOString(), reviewedBy: admin.name };
      const record = event(admin, 'review_feedback', { feedbackId: body.id, category: item.category, status: body.status, note: body.note.trim() });
      const result = await redis(['EVAL', UPDATE_REPORT, 2, FEEDBACK_DATA, HISTORY_KEY, body.id, previous, JSON.stringify(updated), record]);
      if (result !== 1) return res.status(409).json({ error: 'Someone else updated this feedback. Refresh the inbox.' });
      return res.status(200).json({ item: updated });
    }
    if (body.action === 'review_report') {
      if (typeof body.id !== 'string' || !/^[\da-f-]{36}$/i.test(body.id) || !['checking', 'dismissed', 'correction_needed', 'resolved'].includes(body.status) || typeof body.note !== 'string' || !body.note.trim() || body.note.length > 500) return res.status(400).json({ error: 'Choose a status and add a review note.' });
      const previous = await redis(['HGET', REPORTS_DATA, body.id]);
      if (!previous) return res.status(404).json({ error: 'Report not found.' });
      const report = JSON.parse(previous);
      const updated = { ...report, status: body.status, note: body.note.trim(), reviewedAt: new Date().toISOString(), reviewedBy: admin.name };
      const log = event(admin, 'review_report', { reportId: body.id, status: body.status, note: body.note.trim() });
      const result = await redis(['EVAL', UPDATE_REPORT, 2, REPORTS_DATA, HISTORY_KEY, body.id, previous, JSON.stringify(updated), log]);
      if (result !== 1) return res.status(409).json({ error: 'Someone else updated this report. Refresh the inbox.' });
      return res.status(200).json({ report: updated });
    }
    return res.status(400).json({ error: 'Unknown admin action.' });
  } catch {
    console.error('Admin storage operation failed.');
    return res.status(503).json({ error: 'The audit service is unavailable. Refresh history before retrying a change.' });
  }
}

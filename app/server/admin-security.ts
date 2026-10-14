import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { redis } from './admin-store';

export const SECURITY_KEY = 'planora:admin:security:v1';
export type SecurityEvent = { id: string; at: string; action: 'login_success' | 'login_failure' | 'login_blocked'; ip: string; device: string; claimedUsername: string; adminName?: string };
const APPEND = `redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, 199)
redis.call('EXPIRE', KEYS[1], 2592000)
return 1`;

export function clientIp(req: any): string {
  // Vercel overwrites its forwarding header; never trust an unvalidated address.
  const forwarded = req.headers['x-vercel-forwarded-for'] ?? req.headers['x-forwarded-for'];
  const value = String(forwarded || req.socket?.remoteAddress || '').split(',')[0].trim();
  return isIP(value) ? value : 'unknown';
}
export function deviceLabel(req: any): string {
  const ua = String(req.headers['user-agent'] || '').slice(0, 512);
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} · ${os}`;
}
export async function securityEvent(req: any, action: SecurityEvent['action'], claimedUsername: string, adminName?: string): Promise<SecurityEvent> {
  const entry: SecurityEvent = {
    id: randomUUID(), at: new Date().toISOString(), action,
    ip: clientIp(req), device: deviceLabel(req),
    claimedUsername: claimedUsername.slice(0, 64).replace(/[\x00-\x1f\x7f]/g, ''),
    ...(adminName ? { adminName } : {}),
  };
  if (await redis(['EVAL', APPEND, 1, SECURITY_KEY, JSON.stringify(entry)]) !== 1) throw new Error('Security event could not be recorded.');
  return entry;
}

/** Opt in only after deploying the updated private Apps Script mailer. Never send credentials. */
export async function securityEmail(entry: SecurityEvent): Promise<void> {
  if (process.env.PLANORA_SECURITY_MAIL_ENABLED !== 'true') return;
  const url = process.env.PLANORA_REPORT_MAIL_WEBHOOK_URL;
  const secret = process.env.PLANORA_REPORT_MAIL_WEBHOOK_SECRET;
  if (!url || !secret || secret.length < 32 || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) return;
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret, kind: 'security', ...entry }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || (await response.json()).ok !== true) throw new Error('Mail rejected');
  } catch { /* Events remain in the private log even if the mailer is unavailable. */ }
}

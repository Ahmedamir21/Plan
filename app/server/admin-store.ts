/** Private REST adapter. No browser code receives the Redis token. */
import { createHmac } from 'node:crypto';

function connection() {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (upstashUrl && upstashToken) return { url: upstashUrl, token: upstashToken };
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  return kvUrl && kvToken ? { url: kvUrl, token: kvToken } : null;
}
export function storageConfigured() {
  const config = connection();
  return !!config && /^https:\/\//.test(config.url);
}

export async function redis(command: Array<string | number>): Promise<any> {
  const config = connection();
  if (!config || !/^https:\/\//.test(config.url)) throw new Error('Admin history storage is not configured.');
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`History storage failed (${response.status}).`);
  const body = await response.json();
  if (body.error) throw new Error('History storage rejected the command.');
  return body.result;
}

export const HISTORY_KEY = 'planora:admin:history:v1';
// Atomic and shared across all serverless instances. A secret-derived key keeps IPs
// and account names out of the Redis keyspace.
const RATE_LIMIT = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;
export async function rateLimited(scope: string, identity: string, max: number, seconds: number, secret: string): Promise<boolean> {
  const bucket = createHmac('sha256', secret).update(identity).digest('hex');
  const count = await redis(['EVAL', RATE_LIMIT, 1, `planora:limit:${scope}:${bucket}`, seconds]);
  if (!Number.isInteger(count) || count < 1) throw new Error('Invalid rate limit result.');
  return count > max;
}

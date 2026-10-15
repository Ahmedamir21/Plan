/** Private PostgreSQL-backed Redis-compatible adapter. No external paid KV/Redis service is required. */
import { createHmac } from 'node:crypto';
import { database } from './db.js';

type Kind = 'string' | 'list' | 'hash';
type Row = { key: string; kind: Kind; value: any; expires_at: Date | string | null };

export function storageConfigured() {
  return Boolean(process.env.DATABASE_URL && /^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL));
}

function keyName(value: unknown): string {
  const key = String(value ?? '');
  if (!key || key.length > 512) throw new Error('Invalid storage key.');
  return key;
}
function asArray(value: any): any[] {
  if (!Array.isArray(value)) throw new Error('Storage key has the wrong type.');
  return value;
}
function asHash(value: any): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Storage key has the wrong type.');
  return value as Record<string, string>;
}
function expired(row: Row | undefined): boolean {
  return !!row?.expires_at && new Date(row.expires_at).getTime() <= Date.now();
}

async function runCommand(command: Array<string | number>): Promise<any> {
  const db = await database();
  const op = String(command[0] || '').toUpperCase();
  const args = command.slice(1).map(String);
  if (op === 'EVAL') return runScript(command);
  const keys = op === 'HMGET' ? args.slice(0, 1) : ['LRANGE','LTRIM','LLEN','LPUSH','HGET','HSET','INCR','EXPIRE','GET','SET','DEL'].includes(op) ? args.slice(0, op === 'HMGET' ? 1 : 1) : [];
  if (!keys.length) throw new Error('Unsupported storage command.');
  const key = keyName(keys[0]);
  return db.transaction(async sql => {
    await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    const selected = await sql.query('SELECT key, kind, value, expires_at FROM planora.admin_kv_store WHERE key=$1 FOR UPDATE', [key]);
    let row = selected.rows[0] as Row | undefined;
    if (expired(row)) {
      await sql.query('DELETE FROM planora.admin_kv_store WHERE key=$1', [key]);
      row = undefined;
    }
    const write = async (kind: Kind, value: any, expiresAt: Date | null = row?.expires_at ? new Date(row.expires_at) : null) => {
      await sql.query(
        'INSERT INTO planora.admin_kv_store(key,kind,value,expires_at,updated_at) VALUES($1,$2,$3::jsonb,$4,now()) ON CONFLICT(key) DO UPDATE SET kind=EXCLUDED.kind,value=EXCLUDED.value,expires_at=EXCLUDED.expires_at,updated_at=now()',
        [key, kind, JSON.stringify(value), expiresAt]
      );
    };
    switch (op) {
      case 'LRANGE': {
        const list = row ? asArray(row.value) : [];
        const start = Number(args[1] || 0), stop = Number(args[2] || 0);
        const from = start < 0 ? Math.max(0, list.length + start) : start;
        const to = stop < 0 ? list.length + stop : stop;
        return list.slice(from, Math.max(from, to + 1));
      }
      case 'LLEN': return row ? asArray(row.value).length : 0;
      case 'LPUSH': {
        const list = row ? asArray(row.value) : [];
        list.unshift(args[1]);
        await write('list', list);
        return list.length;
      }
      case 'LTRIM': {
        const list = row ? asArray(row.value) : [];
        const start = Number(args[1] || 0), stop = Number(args[2] || 0);
        const from = start < 0 ? Math.max(0, list.length + start) : start;
        const to = stop < 0 ? list.length + stop : stop;
        await write('list', list.slice(from, Math.max(from, to + 1)));
        return 'OK';
      }
      case 'HGET': return row ? (asHash(row.value)[args[1]] ?? null) : null;
      case 'HMGET': {
        const hash = row ? asHash(row.value) : {};
        return args.slice(1).map(field => hash[field] ?? null);
      }
      case 'HSET': {
        const hash = row ? asHash(row.value) : {};
        let added = 0;
        for (let i=1; i+1<args.length; i+=2) {
          if (!(args[i] in hash)) added++;
          hash[args[i]] = args[i+1];
        }
        await write('hash', hash);
        return added;
      }
      case 'INCR': {
        const value = row ? Number(row.value) : 0;
        if (!Number.isSafeInteger(value)) throw new Error('Invalid counter.');
        const next = value + 1;
        await write('string', next);
        return next;
      }
      case 'EXPIRE': {
        if (!row) return 0;
        await sql.query('UPDATE planora.admin_kv_store SET expires_at=now()+($2::text || \' seconds\')::interval, updated_at=now() WHERE key=$1', [key, Number(args[1])]);
        return 1;
      }
      case 'GET': return row ? String(row.value) : null;
      case 'SET': await write('string', args[1]); return 'OK';
      case 'DEL': await sql.query('DELETE FROM planora.admin_kv_store WHERE key=$1', [key]); return row ? 1 : 0;
      default: throw new Error('Unsupported storage command.');
    }
  });
}

async function runScript(command: Array<string | number>): Promise<number> {
  const script = String(command[1] || '');
  const numKeys = Number(command[2]);
  if (!Number.isInteger(numKeys) || numKeys < 1 || numKeys > 10) throw new Error('Invalid storage script.');
  const keys = command.slice(3, 3 + numKeys).map(keyName);
  const args = command.slice(3 + numKeys).map(String);
  const db = await database();
  return db.transaction(async sql => {
    // Deterministic lock ordering avoids deadlocks for multi-key atomic operations.
    for (const key of [...new Set(keys)].sort()) await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    const load = async (key: string): Promise<Row | undefined> => {
      const result = await sql.query('SELECT key,kind,value,expires_at FROM planora.admin_kv_store WHERE key=$1 FOR UPDATE', [key]);
      let row = result.rows[0] as Row | undefined;
      if (expired(row)) {
        await sql.query('DELETE FROM planora.admin_kv_store WHERE key=$1', [key]);
        row = undefined;
      }
      return row;
    };
    const save = async (key: string, kind: Kind, value: any, expiresAt: Date | null = null) => {
      await sql.query('INSERT INTO planora.admin_kv_store(key,kind,value,expires_at,updated_at) VALUES($1,$2,$3::jsonb,$4,now()) ON CONFLICT(key) DO UPDATE SET kind=EXCLUDED.kind,value=EXCLUDED.value,expires_at=COALESCE(EXCLUDED.expires_at,planora.admin_kv_store.expires_at),updated_at=now()', [key,kind,JSON.stringify(value),expiresAt]);
    };
    // Shared rate-limit script.
    if (script.includes("redis.call('INCR', KEYS[1])") && !script.includes('LLEN')) {
      const row = await load(keys[0]);
      const next = Number(row?.value ?? 0) + 1;
      const expiresAt = next === 1 ? new Date(Date.now() + Number(args[0]) * 1000) : row?.expires_at ? new Date(row.expires_at) : null;
      await save(keys[0], 'string', next, expiresAt);
      return next;
    }
    // Atomic report/feedback create script: rate limit, cap inbox, store payload.
    if (script.includes("redis.call('LLEN', KEYS[2])") && script.includes("redis.call('HSET', KEYS[3]")) {
      const limitRow = await load(keys[0]);
      const count = Number(limitRow?.value ?? 0) + 1;
      if (count > Number(script.match(/if n > (\d+)/)?.[1] || 5)) {
        await save(keys[0], 'string', count, count === 1 ? new Date(Date.now()+3600000) : limitRow?.expires_at ? new Date(limitRow.expires_at) : null);
        return 0;
      }
      await save(keys[0], 'string', count, count === 1 ? new Date(Date.now()+3600000) : limitRow?.expires_at ? new Date(limitRow.expires_at) : null);
      const listRow = await load(keys[1]);
      const list = listRow ? asArray(listRow.value) : [];
      if (list.length >= 500) return -1;
      const hashRow = await load(keys[2]);
      const hash = hashRow ? asHash(hashRow.value) : {};
      hash[args[0]] = args[1];
      list.unshift(args[0]);
      await save(keys[2], 'hash', hash);
      await save(keys[1], 'list', list);
      return 1;
    }
    // Append and retain a bounded private security-event log.
    if (script.includes("redis.call('LTRIM', KEYS[1]") && script.includes("redis.call('EXPIRE', KEYS[1]")) {
      const row = await load(keys[0]);
      const list = row ? asArray(row.value) : [];
      list.unshift(args[0]);
      list.splice(200);
      await save(keys[0], 'list', list, new Date(Date.now() + 30 * 86400000));
      return 1;
    }
    // Optimistic update for reviewed report/feedback plus audit event.
    if (script.includes("redis.call('HGET', KEYS[1]") && script.includes("redis.call('LPUSH', KEYS[2]")) {
      const row = await load(keys[0]);
      const hash = row ? asHash(row.value) : {};
      if (!(args[0] in hash) || hash[args[0]] !== args[1]) return 0;
      hash[args[0]] = args[2];
      await save(keys[0], 'hash', hash, row?.expires_at ? new Date(row.expires_at) : null);
      const historyRow = await load(keys[1]);
      const history = historyRow ? asArray(historyRow.value) : [];
      history.unshift(args[3]);
      await save(keys[1], 'list', history, historyRow?.expires_at ? new Date(historyRow.expires_at) : null);
      return 1;
    }
    throw new Error('Unsupported atomic storage operation.');
  });
}

export async function redis(command: Array<string | number>): Promise<any> {
  if (!storageConfigured()) throw new Error('PostgreSQL storage is not configured.');
  try { return await runCommand(command); }
  catch (error) {
    // Keep provider/database errors out of public responses and logs.
    throw new Error('Private PostgreSQL storage operation failed.');
  }
}

export const HISTORY_KEY = 'planora:admin:history:v1';
const RATE_LIMIT = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;
export async function rateLimited(scope: string, identity: string, max: number, seconds: number, secret: string): Promise<boolean> {
  const bucket = createHmac('sha256', secret).update(identity).digest('hex');
  const count = await redis(['EVAL', RATE_LIMIT, 1, `planora:limit:${scope}:${bucket}`, seconds]);
  if (!Number.isInteger(count) || count < 1) throw new Error('Invalid rate limit result.');
  return count > max;
}

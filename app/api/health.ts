/** Preview-only database diagnostic. Never returns connection details or raw errors. */
import { activeTerm, database } from '../server/db.js';
const safeCodes = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  '28P01', '28000', '3D000', '42501', '57P03', '53300',
  'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID'
]);
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  try {
    const db = await database();
    const result = await db.query(
      'SELECT count(*)::int AS courses FROM planora.courses WHERE term_key=$1',
      [activeTerm()]
    );
    return res.status(200).json({ ok: true, database: 'connected', courses: result.rows[0]?.courses ?? 0 });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
    const reason = safeCodes.has(code) ? code : 'DATABASE_CONNECTION_FAILED';
    console.error('PREVIEW_DATABASE_HEALTH_FAILED', reason);
    return res.status(503).json({ ok: false, database: 'unavailable', reason });
  }
}

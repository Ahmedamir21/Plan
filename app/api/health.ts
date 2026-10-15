/** Preview-only database diagnostic. Never returns connection details or raw errors. */
import { database } from '../server/db';
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  try {
    const db = await database();
    const result = await db.query('SELECT count(*)::int AS courses FROM planora.courses WHERE term_key=$1', ['fall-2026-main']);
    return res.status(200).json({ ok: true, database: 'connected', courses: result.rows[0]?.courses ?? 0 });
  } catch {
    return res.status(503).json({ ok: false, database: 'unavailable' });
  }
}

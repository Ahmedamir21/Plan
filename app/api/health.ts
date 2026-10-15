/** Preview diagnostic only: reports a safe DB readiness status, never connection details. */
import { database } from '../server/db';
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET')
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  try {
    const db = await database();
    await db.query('SELECT 1');
    return res.status(200).json({ ok: true, service: 'plan-api', database: 'connected' });
  } catch {
    return res.status(503).json({ ok: false, service: 'plan-api', database: 'unavailable' });
  }
}

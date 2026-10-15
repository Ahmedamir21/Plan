/** Minimal liveness probe with no imports or secrets. */
export default function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  return res.status(200).json({ ok: true, service: 'plan-api-runtime' });
}

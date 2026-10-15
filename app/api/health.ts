/** Public liveness probe; never reads environment variables or database secrets. */
export default function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET')
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  return res.status(200).json({ ok: true, service: 'plan-api' });
}

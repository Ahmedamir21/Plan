/** Common browser API checks. These routes intentionally do not enable cross-origin access. */
export function sameOrigin(req: any): boolean {
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)));
  } catch { return false; }
}

export function jsonRequest(req: any, maxBytes: number): boolean {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] || ''))) return false;
  const length = Number(req.headers?.['content-length']);
  if (Number.isFinite(length) && length > maxBytes) return false;
  try { return Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') <= maxBytes; }
  catch { return false; }
}

/** Only allowlisted, non-sensitive diagnostics may cross an API/log boundary. */
export class SafeError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public details: string[] = []
  ) {
    super(code);
  }
}
export function errorCode(error: unknown): string {
  return error instanceof SafeError ? error.code : 'STORAGE_UNAVAILABLE';
}
export function respondError(res: any, error: unknown) {
  const safe =
    error instanceof SafeError
      ? error
      : new SafeError('STORAGE_UNAVAILABLE', 503);
  return res
    .status(safe.status)
    .json({ error: safe.code, errors: safe.details.slice(0, 30) });
}

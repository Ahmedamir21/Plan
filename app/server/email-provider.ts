import { SafeError } from './errors';
export type EmailMode = 'disabled' | 'mock' | 'resend-test' | 'resend';
export type Mail = { to: string; subject: string; text: string };
export interface EmailProvider {
  send(mail: Mail, key: string): Promise<{ id: string; mocked: boolean }>;
}
export class MailError extends Error {
  constructor(
    public code: string,
    public retryable: boolean
  ) {
    super(code);
  }
}
export function emailMode(): EmailMode {
  const mode = process.env.PLANORA_EMAIL_MODE || 'disabled';
  if (!['disabled', 'mock', 'resend-test', 'resend'].includes(mode))
    throw new SafeError('INVALID_EMAIL_CONFIGURATION', 503);
  return mode as EmailMode;
}
export function emailConfigured(): boolean {
  const mode = emailMode();
  if (
    mode === 'disabled' ||
    (process.env.PLANORA_EMAIL_TOKEN_SECRET || '').length < 32
  )
    return false;
  if (mode === 'mock') return true;
  if (
    !process.env.RESEND_API_KEY ||
    !process.env.PLANORA_EMAIL_FROM ||
    !process.env.PLANORA_PUBLIC_URL
  )
    return false;
  if (mode === 'resend' && process.env.PLANORA_EMAIL_LIVE_APPROVED !== 'true')
    return false;
  if (mode === 'resend-test' && !process.env.PLANORA_EMAIL_TEST_RECIPIENT)
    return false;
  return true;
}
/** No provider SDK or secret enters a browser bundle. The endpoint cannot be supplied by a caller. */
export function emailProvider(fetchImpl: typeof fetch = fetch): EmailProvider {
  const mode = emailMode();
  if (!emailConfigured())
    throw new SafeError('EMAIL_DISABLED_OR_NOT_CONFIGURED', 503);
  if (mode === 'mock')
    return {
      send: async (_mail, key) => ({ id: `mock-${key}`, mocked: true }),
    };
  return {
    async send(mail, key) {
      if (
        mode === 'resend-test' &&
        mail.to.toLowerCase() !==
          process.env.PLANORA_EMAIL_TEST_RECIPIENT?.toLowerCase()
      )
        throw new MailError('TEST_RECIPIENT_ONLY', false);
      let response: Response;
      try {
        response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `planora/${key}`,
          },
          body: JSON.stringify({
            from: process.env.PLANORA_EMAIL_FROM,
            to: [mail.to],
            subject: mail.subject,
            text: mail.text,
          }),
        });
      } catch {
        throw new MailError('EMAIL_DELIVERY_OUTCOME_UNKNOWN', false);
      } // Never blindly resend an ambiguous timeout.
      if (!response.ok)
        throw new MailError(
          response.status === 429
            ? 'EMAIL_RATE_LIMITED'
            : response.status >= 500
              ? 'EMAIL_PROVIDER_TEMPORARY_FAILURE'
              : 'EMAIL_PROVIDER_REJECTED',
          response.status === 429 || response.status >= 500
        );
      const body = await response.json().catch(() => null);
      if (
        typeof body?.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(body.id)
      )
        throw new MailError('EMAIL_DELIVERY_OUTCOME_UNKNOWN', false);
      return { id: body.id, mocked: false };
    },
  };
}

import { z } from 'zod';
import { activeTerm, database } from '../server/db';
import {
  applySubscriptionToken,
  subscribe,
  subscriptionInput,
} from '../server/notifications';
import { emailConfigured, emailMode } from '../server/email-provider';
import { jsonRequest, sameOrigin } from '../server/security';
import { clientIp } from '../server/admin-security';
import { rateLimited } from '../server/admin-store';
import { SafeError, respondError } from '../server/errors';
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method === 'GET')
      return res
        .status(200)
        .json({
          enabled: emailConfigured(),
          mode: emailMode(),
          manageEnabled:
            (process.env.PLANORA_EMAIL_TOKEN_SECRET?.length || 0) >= 32,
        });
    if (req.method !== 'POST') throw new SafeError('METHOD_NOT_ALLOWED', 405);
    if (!sameOrigin(req) || !jsonRequest(req, 8000))
      throw new SafeError('INVALID_NOTIFICATION_REQUEST', 403);
    if (req.body?.action === 'subscribe') {
      if (!emailConfigured())
        throw new SafeError('EMAIL_DISABLED_OR_NOT_CONFIGURED', 503);
      const secret = process.env.PLANORA_EMAIL_TOKEN_SECRET!;
      if (
        await rateLimited('email-request-ip', clientIp(req), 10, 3600, secret)
      )
        throw new SafeError('EMAIL_RATE_LIMITED', 429);
      const parsed = subscriptionInput.safeParse(req.body);
      if (!parsed.success) throw new SafeError('INVALID_SUBSCRIPTION_INPUT');
      if (
        await rateLimited(
          'email-request-address',
          parsed.data.email,
          2,
          3600,
          secret
        )
      )
        return res
          .status(202)
          .json({
            pending: true,
            message:
              'If eligible, a confirmation email will be queued. Existing subscriptions are unchanged.',
          });
      await subscribe(await database(), activeTerm(), parsed.data);
      return res
        .status(202)
        .json({
          pending: true,
          mode: emailMode(),
          message:
            emailMode() === 'mock'
              ? 'Test mode: no real email will be sent.'
              : 'If eligible, a confirmation email will be queued. Existing subscriptions are unchanged.',
        });
    }
    // Signed, version-bound capability links remain usable when delivery is paused.
    // They do not depend on the mail provider or the signup rate-limit store.
    const parsed = z
      .object({
        action: z.enum(['verify', 'unsubscribe']),
        token: z.string().min(1).max(1000),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) throw new SafeError('INVALID_EMAIL_LINK_REQUEST');
    return res
      .status(200)
      .json(
        await applySubscriptionToken(
          await database(),
          parsed.data.token,
          parsed.data.action
        )
      );
  } catch (error) {
    return respondError(res, error);
  }
}

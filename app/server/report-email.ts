import { redis } from './admin-store';

export const REPORT_EMAIL_STATUS = 'planora:reports:email:v1';

/** Optional Google Apps Script mailer. Student text stays in the private inbox. */
export async function notifyAdmins(report: { id: string; courseCode: string; types: string[] }) {
  const url = process.env.PLANORA_REPORT_MAIL_WEBHOOK_URL;
  const secret = process.env.PLANORA_REPORT_MAIL_WEBHOOK_SECRET;
  if (!url || !secret || secret.length < 32 || !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) return 'not configured';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret, id: report.id, courseCode: report.courseCode, types: report.types }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || (await response.json()).ok !== true) throw new Error('Email sender did not confirm the alert.');
    await redis(['HSET', REPORT_EMAIL_STATUS, report.id, 'sent']);
    return 'sent';
  } catch {
    console.error('Report email alert failed.');
    try { await redis(['HSET', REPORT_EMAIL_STATUS, report.id, 'failed']); } catch { /* Report is still in the inbox. */ }
    return 'failed';
  }
}

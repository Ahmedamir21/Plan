/** Public, non-sensitive deployment evidence. SQL is queried; configured ≠ connected. */
import { activeTerm, database } from '../server/db';
import { getCatalog } from '../server/catalog-repository';
import { counts } from '../server/catalog-model';
import { respondError } from '../server/errors';
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  try {
    const db = await database(),
      catalog = await getCatalog(db, activeTerm());
    const binding = process.env.PLANORA_PREVIEW_BINDING_ID
      ? (
          await db.query(
            'SELECT id,repository,purpose FROM plan_preview_guard.binding WHERE singleton=true'
          )
        ).rows[0]
      : null;
    return res
      .status(200)
      .json({
        repository:
          process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
            ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
            : null,
        branch: process.env.VERCEL_GIT_COMMIT_REF || null,
        sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
        environment: process.env.VERCEL_ENV || 'local',
        source: 'postgresql',
        catalog: {
          revision: catalog.revision,
          hash: catalog.hash,
          ...counts(catalog.dataset),
        },
        binding,
        safeguards: {
          productionCutoverApproved:
            process.env.PLANORA_SQL_CUTOVER_APPROVED === 'true',
          universitySyncEnabled:
            process.env.PLANORA_SELF_SERVICE_ENABLED === 'true',
          emailMode: process.env.PLANORA_EMAIL_MODE || 'disabled',
          securityEmailEnabled:
            process.env.PLANORA_SECURITY_MAIL_ENABLED === 'true',
        },
      });
  } catch (error) {
    return respondError(res, error);
  }
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { activeTerm, database, type Sql } from './db';
import { getCatalog, readCatalog } from './catalog-repository';
import {
  canonical,
  counts,
  normalizeDataset,
  sha,
  type Dataset,
} from './catalog-model';
import {
  cancelRun,
  createRun,
  failRun,
  inspectRun,
  publishRun,
  stageRun,
  syncHistory,
} from './sync-service';
import { dispatchSync, syncCapability } from './dispatch';
import { deliverNotifications } from './notifications';
import { SafeError, respondError } from './errors';

const files = [
  'semester.json',
  'courses.json',
  'majors.json',
  'sch.json',
] as const;
type File = (typeof files)[number];
type Admin = { id: string; name: string };
const fileName = (value: unknown): value is File =>
  typeof value === 'string' && (files as readonly string[]).includes(value);
const field = (file: File) => file.slice(0, -5) as keyof Dataset;
const uuid = z.string().uuid();
function checked<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new SafeError('INVALID_ADMIN_INPUT');
  return result.data;
}
function reason(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500)
    throw new SafeError('REVIEW_REASON_REQUIRED');
  return value.trim();
}
async function drafts(sql: Sql, term: string, dataset: Dataset) {
  const combined = structuredClone(dataset);
  for (const row of (
    await sql.query(
      'SELECT file,content FROM planora.admin_drafts WHERE term_key=$1',
      [term]
    )
  ).rows)
    (combined as any)[field(row.file)] = JSON.parse(row.content);
  return combined;
}
async function draftValue(sql: Sql, term: string, file: File) {
  return (
    (
      await sql.query(
        'SELECT content FROM planora.admin_drafts WHERE term_key=$1 AND file=$2 FOR UPDATE',
        [term, file]
      )
    ).rows[0]?.content ?? ''
  );
}
async function event(
  sql: Sql,
  term: string,
  admin: Admin,
  action: string,
  file: File,
  before: string,
  after: string,
  source: string
) {
  const id = randomUUID();
  const result = await sql.query(
    `INSERT INTO planora.admin_catalog_events(id,term_key,admin_id,admin_name,action,file,before_content,after_content,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING created_at`,
    [id, term, admin.id, admin.name, action, file, before, after, source]
  );
  return {
    id,
    at: result.rows[0].created_at,
    adminId: admin.id,
    adminName: admin.name,
    action,
    file,
    before,
    after,
    source,
    method:
      action === 'save_draft'
        ? 'Planora admin JSON editor'
        : 'SQL catalog publication',
    changed: [file],
  };
}
export async function academicHistory(limit: number) {
  const rows = (
    await (
      await database()
    ).query(
      'SELECT * FROM planora.admin_catalog_events WHERE term_key=$1 ORDER BY created_at DESC,id DESC LIMIT $2',
      [activeTerm(), limit]
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    at: new Date(r.created_at).toISOString(),
    adminId: r.admin_id,
    adminName: r.admin_name,
    action: r.action,
    file: r.file,
    before: r.before_content,
    after: r.after_content,
    source: r.reason,
    changed: [r.file],
    method:
      r.action === 'save_draft'
        ? 'Planora admin JSON editor'
        : 'SQL catalog publication',
  }));
}
const getActions = ['sync_status', 'sync_run', 'sync_backup', 'draft', 'live'];
const postActions = [
  'sync_start',
  'notifications_deliver',
  'catalog_stage_drafts',
  'sync_publish',
  'sync_cancel',
  'sync_restore',
  'sync_stage',
  'sync_discard',
  'save',
  'save_draft',
  'undo',
  'undo_live',
  'validate',
  'export',
];
/** Returns false for non-academic actions; all authorization/CSRF checks happen in admin.ts first. */
export async function adminCatalog(
  req: any,
  res: any,
  admin: Admin
): Promise<boolean> {
  const action = req.method === 'GET' ? req.query?.action : req.body?.action;
  if (!(req.method === 'GET' ? getActions : postActions).includes(action))
    return false;
  try {
    const db = await database(),
      term = activeTerm(),
      body = req.body || {};
    if (req.method === 'GET') {
      if (action === 'sync_status') {
        const page = checked(
          z.coerce.number().int().min(0).max(10000),
          req.query?.page ?? 0
        );
        res
          .status(200)
          .json({
            ...(await syncHistory(db, term, page)),
            capability: syncCapability(),
            emailMode: process.env.PLANORA_EMAIL_MODE || 'disabled',
          });
        return true;
      }
      if (action === 'sync_run') {
        res
          .status(200)
          .json(await inspectRun(db, checked(uuid, req.query?.id), term));
        return true;
      }
      if (action === 'sync_backup') {
        const revision = checked(
          z.coerce.number().int().positive(),
          req.query?.revision
        );
        const snapshot = (
          await db.query(
            'SELECT revision,created_at,dataset FROM planora.catalog_snapshots WHERE term_key=$1 AND revision=$2',
            [term, revision]
          )
        ).rows[0];
        if (!snapshot) throw new SafeError('SNAPSHOT_NOT_FOUND', 404);
        res.status(200).json({ backup: snapshot });
        return true;
      }
      if (!fileName(req.query?.file)) throw new SafeError('INVALID_FILENAME');
      const file = req.query.file;
      if (action === 'draft') {
        const content =
          (
            await db.query(
              'SELECT content FROM planora.admin_drafts WHERE term_key=$1 AND file=$2',
              [term, file]
            )
          ).rows[0]?.content ?? null;
        res
          .status(200)
          .json({ content, revision: content ? sha(content) : '' });
        return true;
      }
      const live = await getCatalog(db, term),
        content = canonical(live.dataset[field(file)]);
      res
        .status(200)
        .json({
          content,
          revision: sha(content),
          catalogRevision: live.revision,
        });
      return true;
    }
    if (action === 'notifications_deliver') {
      checked(
        z
          .object({
            action: z.literal('notifications_deliver'),
            confirmed: z.literal(true),
          })
          .strict(),
        body
      );
      res.status(200).json(await deliverNotifications(db, 3));
      return true;
    }
    if (action === 'sync_start') {
      checked(
        z
          .object({
            action: z.literal('sync_start'),
            confirmed: z.literal(true),
          })
          .strict(),
        body
      );
      res.status(202).json(await dispatchSync(db, admin.id));
      return true;
    }
    if (action === 'catalog_stage_drafts') {
      const input = checked(
        z
          .object({
            action: z.literal('catalog_stage_drafts'),
            reason: z.string().min(1).max(500),
            confirmed: z.literal(true),
          })
          .strict(),
        body
      );
      const current = await getCatalog(db, term);
      const candidate = normalizeDataset(
        await drafts(db, term, current.dataset)
      ).dataset;
      const run = await createRun(db, term, admin.id, 'admin');
      try {
        if (run.baseRevision !== current.revision)
          throw new SafeError('LIVE_CATALOG_CHANGED_RELOAD', 409);
        res
          .status(200)
          .json({
            ...(await stageRun(db, run.id, candidate)),
            message: 'Saved drafts staged for review; not published.',
            reason: input.reason,
          });
      } catch (error) {
        await failRun(db, run.id, 'DRAFT_VALIDATION_FAILED');
        throw error;
      }
      return true;
    }
    if (action === 'sync_publish') {
      const input = checked(
        z
          .object({
            action: z.literal('sync_publish'),
            id: uuid,
            hash: z.string().regex(/^[a-f0-9]{64}$/),
            reason: z.string().min(1).max(500),
            approveRemovals: z.boolean(),
          })
          .strict(),
        body
      );
      // Term ownership check prevents cross-term publication through this deployment.
      await inspectRun(db, input.id, term);
      res
        .status(200)
        .json(
          await publishRun(
            db,
            input.id,
            input.hash,
            admin.id,
            input.reason,
            input.approveRemovals
          )
        );
      return true;
    }
    if (action === 'sync_cancel') {
      const input = checked(
        z.object({ action: z.literal('sync_cancel'), id: uuid }).strict(),
        body
      );
      await inspectRun(db, input.id, term);
      await cancelRun(db, input.id, admin.id);
      res.status(200).json({ cancelled: true });
      return true;
    }
    if (action === 'sync_restore') {
      const input = checked(
        z
          .object({
            action: z.literal('sync_restore'),
            revision: z.number().int().positive(),
            reason: z.string().min(1).max(500),
          })
          .strict(),
        body
      );
      const snapshot = (
        await db.query(
          'SELECT dataset FROM planora.catalog_snapshots WHERE term_key=$1 AND revision=$2',
          [term, input.revision]
        )
      ).rows[0];
      if (!snapshot) throw new SafeError('SNAPSHOT_NOT_FOUND', 404);
      const run = await createRun(db, term, admin.id, 'recovery');
      try {
        const staged = await stageRun(db, run.id, snapshot.dataset);
        res
          .status(200)
          .json({
            ...staged,
            message: 'Recovery staged for review; not published.',
            reason: input.reason,
          });
      } catch (error) {
        await failRun(db, run.id, 'RECOVERY_VALIDATION_FAILED');
        throw error;
      }
      return true;
    }
    if (action === 'sync_stage' || action === 'sync_discard')
      throw new SafeError('LEGACY_SYNC_RETIRED', 410);
    if (!fileName(body.file)) throw new SafeError('INVALID_FILENAME');
    const file = body.file;
    if (action === 'validate' || action === 'export') {
      const result = await db.transaction(async (sql) => {
        const current = await readCatalog(sql, term),
          combined = await drafts(sql, term, current.dataset);
        if (action === 'validate') {
          if (typeof body.content !== 'string' || body.content.length > 250000)
            throw new SafeError('INVALID_DATASET');
          try {
            (combined as any)[field(file)] = JSON.parse(body.content);
          } catch {
            throw new SafeError('INVALID_JSON');
          }
        }
        try {
          const checked = normalizeDataset(combined);
          if (action === 'validate')
            return {
              errors: [],
              warnings: checked.warnings,
              summary: counts(checked.dataset),
            };
          const content = await draftValue(sql, term, file);
          if (!content) throw new SafeError('SAVE_DRAFT_BEFORE_EXPORT');
          return { content };
        } catch (error) {
          if (action === 'validate' && error instanceof SafeError)
            return {
              errors: error.details.length ? error.details : [error.code],
              warnings: [],
              summary: counts(current.dataset),
            };
          throw error;
        }
      }, action === 'validate');
      res.status(200).json(result);
      return true;
    }
    if (action === 'save' || action === 'save_draft' || action === 'undo') {
      const source = reason(body.source);
      if (typeof body.expectedRevision !== 'string')
        throw new SafeError('REVISION_REQUIRED', 409);
      let content = body.content;
      if (action === 'undo') {
        const last = (
          await db.query(
            `SELECT before_content FROM planora.admin_catalog_events WHERE term_key=$1 AND file=$2 AND action IN ('save_draft','undo_draft','save_live') ORDER BY created_at DESC,id DESC LIMIT 1`,
            [term, file]
          )
        ).rows[0];
        if (!last) throw new SafeError('NO_DRAFT_HISTORY', 409);
        content = last.before_content;
      }
      if (typeof content !== 'string' || content.length > 250000)
        throw new SafeError('INVALID_DATASET');
      const live = await getCatalog(db, term);
      const combined = await drafts(db, term, live.dataset);
      if (content) {
        try {
          (combined as any)[field(file)] = JSON.parse(content);
        } catch {
          throw new SafeError('INVALID_JSON');
        }
      } else (combined as any)[field(file)] = live.dataset[field(file)];
      let validated;
      try {
        validated = normalizeDataset(combined);
      } catch (error) {
        if (error instanceof SafeError)
          throw new SafeError(error.code, 400, error.details);
        throw error;
      }
      if (validated.dataset.semester.key !== term)
        throw new SafeError('TERM_CHANGE_REQUIRES_MIGRATION');
      const saveDraft = async (sql: Sql) => {
        // Lock term first to serialize even the initial absent draft row.
        await sql.query(
          'SELECT term_key FROM planora.catalog_state WHERE term_key=$1 FOR UPDATE',
          [term]
        );
        const previous = await draftValue(sql, term, file);
        if ((previous ? sha(previous) : '') !== body.expectedRevision)
          throw new SafeError('DRAFT_CHANGED_RELOAD', 409);
        if (!content)
          await sql.query(
            'DELETE FROM planora.admin_drafts WHERE term_key=$1 AND file=$2',
            [term, file]
          );
        else
          await sql.query(
            `INSERT INTO planora.admin_drafts(term_key,file,content) VALUES($1,$2,$3) ON CONFLICT(term_key,file) DO UPDATE SET content=EXCLUDED.content,updated_at=now()`,
            [term, file, content]
          );
        return event(
          sql,
          term,
          admin,
          action === 'undo'
            ? 'undo_draft'
            : action === 'save' && ['courses.json', 'sch.json'].includes(file)
              ? 'save_live'
              : 'save_draft',
          file,
          previous,
          content,
          source
        );
      };
      if (action === 'save' && ['courses.json', 'sch.json'].includes(file)) {
        const liveContent = canonical(live.dataset[field(file)]);
        if (
          typeof body.expectedLiveRevision !== 'string' ||
          body.expectedLiveRevision !== sha(liveContent)
        )
          throw new SafeError('LIVE_CATALOG_CHANGED_RELOAD', 409);
        // Publish only this file, never implicitly publish other private drafts.
        const candidate = normalizeDataset({
          ...live.dataset,
          [field(file)]: JSON.parse(content),
        }).dataset;
        const run = await createRun(db, term, admin.id, 'admin');
        try {
          if (run.baseRevision !== live.revision)
            throw new SafeError('LIVE_CATALOG_CHANGED_RELOAD', 409);
          const staged = await stageRun(db, run.id, candidate);
          if (staged.status !== 'awaiting_review')
            throw new SafeError('NO_CHANGES_TO_PUBLISH');
          let entry: any;
          // Editor preserves existing no-removals behavior; use sync review for deliberate removals.
          const result = await publishRun(
            db,
            run.id,
            staged.hash,
            admin.id,
            source,
            false,
            async (sql) => {
              entry = await saveDraft(sql);
            }
          );
          res
            .status(200)
            .json({
              ...result,
              revision: sha(content),
              liveRevision: sha(canonical(candidate[field(file)])),
              entry,
              published: true,
            });
        } catch (error) {
          await cancelRun(db, run.id, admin.id).catch(() => {});
          throw error;
        }
      } else {
        const entry = await db.transaction(saveDraft);
        res.status(200).json({ revision: content ? sha(content) : '', entry });
      }
      return true;
    }
    if (action === 'undo_live') {
      // Old one-click undo is now a reviewable recovery proposal; no unreviewed removals.
      if (typeof body.expectedLiveRevision !== 'string')
        throw new SafeError('REVISION_REQUIRED', 409);
      const current = await getCatalog(db, term);
      if (
        sha(canonical(current.dataset[field(file)])) !==
        body.expectedLiveRevision
      )
        throw new SafeError('LIVE_CATALOG_CHANGED_RELOAD', 409);
      const snapshot = (
        await db.query(
          'SELECT dataset FROM planora.catalog_snapshots WHERE term_key=$1 AND revision=$2',
          [term, current.revision - 1]
        )
      ).rows[0];
      if (!snapshot) throw new SafeError('NO_PREVIOUS_PUBLICATION', 409);
      const run = await createRun(db, term, admin.id, 'recovery');
      try {
        res
          .status(200)
          .json({
            ...(await stageRun(db, run.id, {
              ...current.dataset,
              [field(file)]: snapshot.dataset[field(file)],
            })),
            staged: true,
            message:
              'Recovery staged. Review and publish it in Self-Service Sync.',
          });
      } catch (error) {
        await failRun(db, run.id, 'RECOVERY_VALIDATION_FAILED');
        throw error;
      }
      return true;
    }
    throw new SafeError('UNKNOWN_ADMIN_ACTION');
  } catch (error) {
    respondError(res, error);
    return true;
  }
}

import { useCallback, useEffect, useState } from 'react';

type Summary = {
  courses?: number;
  sections?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  additions?: number;
  removals?: number;
  modifications?: number;
  validationErrors?: number;
  skipped?: number;
  pagesRead?: number;
  pageCount?: number;
};
type Run = {
  id: string;
  source: string;
  status: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  summary: Summary;
  diagnostics: string[];
  error_code?: string;
  proposed_hash?: string;
  reviewed_by?: string;
  review_reason?: string;
};
type Status = {
  runs: Run[];
  hasMore: boolean;
  lastSuccess: string | null;
  lastAttempt: string | null;
  active: { id: string; status: string } | null;
  capability: { enabled: boolean; reason: string | null };
  deliveries: { status: string; count: number }[];
  snapshots: { revision: number; created_at: string }[];
  emailMode: string;
};
type AcademicChange = {
  category: string;
  courseId?: string;
  course_legacy_id?: string;
  code?: string;
  course_code?: string;
  sectionKey?: string;
  section_key?: string;
  fields: string[];
  before?: unknown;
  after?: unknown;
  before_value?: unknown;
  after_value?: unknown;
};
type Review = {
  id: string;
  status: string;
  hash: string;
  changes: AcademicChange[];
  published: boolean;
};
export const statusLabels: Record<string, string> = {
  idle: 'Idle',
  queued: 'Queued',
  running: 'Running',
  validating: 'Validating',
  awaiting_review: 'Awaiting review — not published',
  applying: 'Applying changes',
  completed: 'Completed',
  completed_with_warnings: 'Completed with warnings',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const when = (date?: string | null) =>
  date ? new Date(date).toLocaleString() : 'Not yet';
async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(65000),
    ...init,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      [
        data.error || 'Sync service unavailable',
        ...(data.errors || []).slice(0, 5),
      ].join(' · ')
    );
  return data;
}
const post = (body: unknown) =>
  request('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
export function AdminSelfServiceSync({
  onActivity,
}: {
  onActivity?: () => void;
}) {
  const [data, setData] = useState<Status | null>(null),
    [page, setPage] = useState(0),
    [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [reason, setReason] = useState(''),
    [approveRemovals, setApproveRemovals] = useState(false);
  const refresh = useCallback(async () => {
    const next: Status = await request(
      `/api/admin?action=sync_status&page=${page}`
    );
    setData(next);
    setError('');
  }, [page]);
  useEffect(() => {
    let stopped = false;
    void refresh().catch((e) => {
      if (!stopped) setError(e.message);
    });
    return () => {
      stopped = true;
    };
  }, [refresh]);
  useEffect(() => {
    if (
      !data?.active ||
      !['queued', 'running', 'validating', 'applying'].includes(
        data.active.status
      )
    )
      return;
    // Poll known active jobs only. No overlapping requests, no invented progress percentage.
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
      } catch (e) {
        if (!stopped)
          setError(e instanceof Error ? e.message : 'Status unavailable');
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 10000);
      }
    };
    timer = setTimeout(() => void poll(), 5000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [data?.active?.id, data?.active?.status, refresh]);
  const runAction = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await action();
      setMessage(success);
      await refresh();
      onActivity?.();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Operation failed. Refresh history before retrying.'
      );
    } finally {
      setBusy(false);
    }
  };
  const inspect = async (run: Run) => {
    setReview(null);
    setApproveRemovals(false);
    await runAction(
      async () =>
        setReview(
          await request(
            `/api/admin?action=sync_run&id=${encodeURIComponent(run.id)}`
          )
        ),
      ''
    );
  };
  const trigger = () => {
    if (
      !window.confirm(
        'Read the approved Self-Service academic catalog and stage validated differences for review? This cannot add, drop, or change student registrations.'
      )
    )
      return;
    void runAction(
      () => post({ action: 'sync_start', confirmed: true }),
      'Sync queued. Publication requires a separate review.'
    );
  };
  const publish = () => {
    if (!review || !reason.trim()) return;
    if (
      !window.confirm(
        'Publish this reviewed academic change set to the SQL catalog? Saved student schedules and Self-Service registrations will not be modified.'
      )
    )
      return;
    void runAction(async () => {
      await post({
        action: 'sync_publish',
        id: review.id,
        hash: review.hash,
        reason: reason.trim(),
        approveRemovals,
      });
      setReview(null);
      setReason('');
    }, 'Publication committed. The public catalog and change history are now updated.');
  };
  const download = async (revision: number) => {
    const result = await request(
      `/api/admin?action=sync_backup&revision=${revision}`
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result.backup, null, 2)], {
        type: 'application/json',
      })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `planora-sql-revision-${revision}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const current =
    data?.runs.find((r) => r.id === data.active?.id) || data?.runs[0];
  const summary = current?.summary || {};
  const reviewRun = data?.runs.find((r) => r.id === review?.id);
  return (
    <section className="panel p-5" aria-labelledby="sync-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sync-heading" className="text-lg font-bold">
            Self-Service synchronization
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Read academic catalog → validate complete coverage → inspect
            differences → publish atomically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn px-3 py-2"
            disabled={busy}
            onClick={() => void runAction(refresh, 'Status refreshed.')}
          >
            Refresh status
          </button>
          <button
            className="btn btn-accent px-4 py-2"
            disabled={busy || !data?.capability.enabled || !!data.active}
            onClick={trigger}
          >
            Sync Self-Service
          </button>
        </div>
      </div>
      {!data && !error && (
        <p className="mt-4" role="status">
          Loading synchronization history…
        </p>
      )}
      {data && !data.capability.enabled && (
        <p className="panel-soft mt-4 p-3 text-sm" role="note">
          <strong>Live collection is disabled.</strong> {data.capability.reason}
          . An authorized, dedicated read-only catalog endpoint and its format
          must be verified before enabling the worker. No login or registration
          controls are guessed.
        </p>
      )}
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            statusLabels[data?.active?.status || current?.status || 'idle'] ||
              'Unknown',
            'Current / latest status',
          ],
          [when(data?.lastSuccess), 'Last successful Self-Service sync'],
          [when(data?.lastAttempt), 'Last attempted Self-Service sync'],
          [
            `${summary.courses ?? '—'} / ${summary.sections ?? '—'}`,
            'Courses / sections discovered',
          ],
        ].map(([value, label]) => (
          <div className="panel-soft p-3" key={label}>
            <dt className="text-xs" style={{ color: 'var(--muted)' }}>
              {label}
            </dt>
            <dd
              className="mt-1 font-semibold"
              role={label === 'Current / latest status' ? 'status' : undefined}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Inserted', summary.inserted],
          ['Updated', summary.updated],
          ['Unchanged', summary.unchanged],
          [
            'Add / remove / modify',
            `${summary.additions ?? '—'} / ${summary.removals ?? '—'} / ${summary.modifications ?? '—'}`,
          ],
          ['Validation errors', summary.validationErrors],
          ['Skipped records', summary.skipped],
        ].map(([label, value]) => (
          <div className="panel-soft p-3" key={label}>
            <dt className="text-xs">{label}</dt>
            <dd className="font-bold">{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
        Record counts include courses and sections. Partial collection is never
        published; a failed run keeps the last known-good catalog.
      </p>
      {current?.error_code && (
        <p className="mt-3 text-sm" role="alert">
          {current.error_code}. Check the approved source contract and private
          worker configuration, then retry. Do not bypass a security challenge.
        </p>
      )}
      {!!current?.diagnostics.length && (
        <details className="panel-soft mt-3 p-3">
          <summary className="cursor-pointer font-semibold">
            Validation / review notices ({current.diagnostics.length})
          </summary>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {current.diagnostics.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="mt-5">
        <h3 className="font-semibold">Synchronization history</h3>
        {!data?.runs.length ? (
          <p className="mt-2 text-sm">No runs recorded yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {data.runs.map((run) => (
              <li
                className="panel-soft flex flex-wrap items-center justify-between gap-3 p-3"
                key={run.id}
              >
                <div>
                  <b className="text-sm">
                    {statusLabels[run.status] || run.status}
                  </b>
                  <p className="text-xs">
                    {when(run.created_at)} · {run.source}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    Run {run.id.slice(0, 8)} · Finished: {when(run.finished_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn px-3 py-2 text-xs"
                    disabled={busy}
                    onClick={() => void inspect(run)}
                  >
                    Inspect changes
                  </button>
                  {[
                    'queued',
                    'running',
                    'validating',
                    'awaiting_review',
                  ].includes(run.status) && (
                    <button
                      className="btn px-3 py-2 text-xs"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Cancel this run? The public catalog will remain unchanged.'
                          )
                        )
                          void runAction(
                            () => post({ action: 'sync_cancel', id: run.id }),
                            'Run cancelled; the catalog was not changed.'
                          );
                      }}
                    >
                      Cancel run
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-2">
          <button
            className="btn px-3 py-2 text-xs"
            disabled={busy || page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Newer runs
          </button>
          <button
            className="btn px-3 py-2 text-xs"
            disabled={busy || !data?.hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Older runs
          </button>
        </div>
      </div>
      {review && (
        <div className="panel-soft mt-5 p-4" aria-label="Change inspection">
          <h3 className="font-semibold">
            {review.published
              ? 'Committed academic changes'
              : 'Proposed academic changes — not published'}
          </h3>
          <p className="mt-1 text-xs">
            {review.changes.length} change records · Run {review.id.slice(0, 8)}
          </p>
          <div className="mt-3 max-h-96 space-y-2 overflow-auto">
            {review.changes.length === 0 ? (
              <p>No academic differences recorded.</p>
            ) : (
              review.changes.map((change, index) => (
                <details
                  className="rounded-lg border p-3"
                  style={{ borderColor: 'var(--line)' }}
                  key={index}
                >
                  <summary className="cursor-pointer text-sm">
                    <b>
                      {change.code || change.course_code || 'Catalog metadata'}
                    </b>{' '}
                    · {change.sectionKey || change.section_key || ''} ·{' '}
                    {change.category.replace(/_/g, ' ')}
                  </summary>
                  <p className="mt-2 text-xs">
                    Fields: {change.fields.join(', ')}
                  </p>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <div>
                      <b className="text-xs">Previous</b>
                      <pre className="mt-1 overflow-auto whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(
                          change.before ?? change.before_value ?? null,
                          null,
                          2
                        )}
                      </pre>
                    </div>
                    <div>
                      <b className="text-xs">Proposed / committed</b>
                      <pre className="mt-1 overflow-auto whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(
                          change.after ?? change.after_value ?? null,
                          null,
                          2
                        )}
                      </pre>
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
          {!review.published && review.status === 'awaiting_review' && (
            <>
              <label className="mt-4 block text-sm font-semibold">
                Verification and publication reason
                <input
                  className="select mt-1 w-full"
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe the official source and coverage you checked"
                />
              </label>
              {!!review.changes.some((c) =>
                c.category.endsWith('_removed')
              ) && (
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={approveRemovals}
                    onChange={(e) => setApproveRemovals(e.target.checked)}
                  />
                  I verified the complete source coverage and explicitly approve
                  these removals.
                </label>
              )}
              <button
                className="btn btn-accent mt-3 px-4 py-2"
                disabled={
                  busy ||
                  !reason.trim() ||
                  (!!review.changes.some((c) =>
                    c.category.endsWith('_removed')
                  ) &&
                    !approveRemovals)
                }
                onClick={publish}
              >
                Publish reviewed changes
              </button>
            </>
          )}
          {reviewRun?.review_reason && (
            <p className="mt-3 text-xs">
              Reviewed by {reviewRun.reviewed_by}: {reviewRun.review_reason}
            </p>
          )}
        </div>
      )}
      <details className="panel-soft mt-5 p-4">
        <summary className="cursor-pointer font-semibold">
          Saved data drafts and recovery snapshots
        </summary>
        <p className="mt-2 text-sm">
          Stage all saved editor drafts (including term metadata and major
          mappings), or stage a previous SQL snapshot. Both require inspection
          and a separate publication approval.
        </p>
        <label className="mt-3 block text-sm">
          Reason
          <input
            className="select mt-1 w-full"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          className="btn mt-3 px-4 py-2"
          disabled={busy || !reason.trim() || !!data?.active}
          onClick={() => {
            if (
              window.confirm(
                'Stage all saved data drafts for review? This does not publish them.'
              )
            )
              void runAction(
                () =>
                  post({
                    action: 'catalog_stage_drafts',
                    reason,
                    confirmed: true,
                  }),
                'Saved drafts staged. Inspect the newest run before publishing.'
              );
          }}
        >
          Stage saved data drafts
        </button>
        <ul className="mt-4 space-y-2">
          {data?.snapshots.map((snapshot) => (
            <li
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
              key={snapshot.revision}
            >
              <span>
                Revision {snapshot.revision} · {when(snapshot.created_at)}
              </span>
              <div className="flex gap-2">
                <button
                  className="btn px-3 py-2 text-xs"
                  disabled={busy}
                  onClick={() =>
                    void runAction(
                      () => download(snapshot.revision),
                      'Snapshot downloaded.'
                    )
                  }
                >
                  Download
                </button>
                <button
                  className="btn px-3 py-2 text-xs"
                  disabled={busy || !!data.active || !reason.trim()}
                  onClick={() =>
                    void runAction(
                      () =>
                        post({
                          action: 'sync_restore',
                          revision: snapshot.revision,
                          reason,
                        }),
                      'Recovery proposal staged; inspect and approve it before publication.'
                    )
                  }
                >
                  Stage recovery
                </button>
              </div>
            </li>
          ))}
        </ul>
      </details>
      <div className="panel-soft mt-4 p-3">
        <h3 className="font-semibold">Email delivery</h3>
        <p className="mt-1 text-sm">
          Mode: {data?.emailMode || 'disabled'}.{' '}
          {data?.deliveries.length
            ? data.deliveries.map((d) => `${d.status}: ${d.count}`).join(' · ')
            : 'No deliveries queued.'}
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          Only verified subscribers and committed academic changes are eligible.
          Mock deliveries are not real emails.
        </p>
        <button
          className="btn mt-3 px-3 py-2 text-xs"
          disabled={busy || !data || data.emailMode === 'disabled'}
          onClick={() => {
            if (
              window.confirm(
                'Process up to three queued emails using the configured delivery mode? Live mode sends real emails to verified, opted-in recipients.'
              )
            )
              void runAction(
                () =>
                  post({ action: 'notifications_deliver', confirmed: true }),
                'Delivery batch processed. Review the delivery states above; mocked messages are not real emails.'
              );
          }}
        >
          Process next email batch
        </button>
      </div>
      {busy && (
        <p className="mt-3 text-sm" role="status">
          Waiting for the server… Do not submit again.
        </p>
      )}
      {error && (
        <p
          className="mt-3 break-words text-sm"
          role="alert"
          style={{ color: 'var(--warn)' }}
        >
          {error}
        </p>
      )}
      {message && (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { COURSES } from '../data/courses';
function emailLink() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.hash.slice(1)),
    action = params.get('emailAction'),
    token = params.get('token');
  return (action === 'verify' || action === 'unsubscribe') &&
    token &&
    token.length <= 1000
    ? { action, token }
    : null;
}
export function EmailNotifications() {
  const [link, setLink] = useState(emailLink),
    [open, setOpen] = useState(() => !!emailLink());
  const [status, setStatus] = useState<{
      enabled: boolean;
      mode: string;
      manageEnabled: boolean;
    } | null>(null),
    [email, setEmail] = useState(''),
    [filter, setFilter] = useState(''),
    [ids, setIds] = useState<string[]>([]),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    if (link)
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
  }, [link]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void fetch('/api/notifications', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('Notification service unavailable');
        return r.json();
      })
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [open]);
  const courses = useMemo(
    () =>
      COURSES.filter((c) =>
        `${c.code} ${c.name}`.toLowerCase().includes(filter.toLowerCase())
      ),
    [filter]
  );
  const submit = async (body: unknown) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error || 'Could not update notification preferences.'
        );
      setMessage(data.message || `Subscription ${data.status}.`);
      setLink(null);
      if (data.pending) {
        setEmail('');
        setConsent(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Notification request failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="panel mx-auto my-3 max-w-7xl p-4 no-print"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">
        Course email notifications{' '}
        <span className="ml-2 text-xs font-normal">
          Optional · explicit opt-in
        </span>
      </summary>
      <p className="mt-3 text-sm">
        Choose individual courses to follow. We do not send your saved schedule
        to the synchronization agent. Subscriptions require email verification
        and can be cancelled using the link in each email.
      </p>
      {!status && !error && (
        <p className="mt-3 text-sm" role="status">
          Checking notification availability…
        </p>
      )}
      {status && !status.enabled && (
        <p className="mt-3 text-sm">
          Email notifications are not enabled for this deployment. Public change
          history remains available.
        </p>
      )}
      {status?.enabled && status.mode !== 'resend' && (
        <p className="panel-soft mt-3 p-3 text-sm">
          Test mode: {status.mode}.{' '}
          {status.mode === 'mock'
            ? 'No real email will be sent.'
            : 'Only the configured test recipient can receive mail.'}
        </p>
      )}
      {link && (
        <div className="panel-soft mt-4 p-4">
          <h3 className="font-semibold">
            {link.action === 'verify'
              ? 'Confirm your course-update subscription'
              : 'Cancel your course-update subscription'}
          </h3>
          <p className="mt-2 text-sm">
            Nothing changes until you select the button below.
          </p>
          <button
            className="btn btn-accent mt-3 px-4 py-2"
            disabled={busy || !status?.manageEnabled}
            onClick={() => void submit(link)}
          >
            {link.action === 'verify'
              ? 'Confirm email subscription'
              : 'Unsubscribe'}
          </button>
        </div>
      )}
      {status?.enabled && !link && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit({
              action: 'subscribe',
              email,
              courseIds: ids,
              consent,
            });
          }}
        >
          <label className="block text-sm">
            Email address
            <input
              type="email"
              required
              autoComplete="email"
              className="select mt-1 w-full max-w-md"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Find courses to follow
            <input
              className="select mt-1 w-full max-w-md"
              value={filter}
              maxLength={100}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Code or title"
            />
          </label>
          <fieldset className="panel-soft max-h-56 space-y-2 overflow-auto p-3">
            <legend className="text-sm">
              Select up to 30 courses ({ids.length} selected)
            </legend>
            {courses.map((course) => (
              <label className="flex items-start gap-2 text-sm" key={course.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(course.id)}
                  disabled={!ids.includes(course.id) && ids.length >= 30}
                  onChange={(e) =>
                    setIds((previous) =>
                      e.target.checked
                        ? [...previous, course.id]
                        : previous.filter((id) => id !== course.id)
                    )
                  }
                />
                <span>
                  <b>{course.code}</b> · {course.name}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I agree to receive academic change emails for the courses I
              selected. I can unsubscribe at any time.
            </span>
          </label>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Already subscribed? Existing interests cannot be changed by an
            unverified request. Unsubscribe using your email link, then select
            new courses and verify again.
          </p>
          <button
            className="btn btn-accent px-4 py-2"
            disabled={busy || !email || !consent || !ids.length}
          >
            Request confirmation email
          </button>
        </form>
      )}
      {busy && (
        <p className="mt-3 text-sm" role="status">
          Submitting…
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      )}
    </details>
  );
}

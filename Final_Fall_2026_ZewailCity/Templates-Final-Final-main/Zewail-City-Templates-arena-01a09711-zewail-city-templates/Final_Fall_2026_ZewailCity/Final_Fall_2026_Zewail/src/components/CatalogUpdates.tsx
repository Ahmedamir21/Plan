import { useEffect, useState } from 'react';
import { SEMESTER_CONFIG } from '../config/semester';
import { catalogPublishedAt, catalogRevision } from '../lib/catalogClient';
interface Change {
  id: string;
  course_code: string | null;
  course_title: string | null;
  category: string;
  section_key: string | null;
  fields: string[];
  published_at: string;
  before_value: unknown;
  after_value: unknown;
}
export function CatalogUpdates() {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [term, setTerm] = useState(SEMESTER_CONFIG.key),
    [search, setSearch] = useState({
      q: '',
      category: '',
      term: SEMESTER_CONFIG.key,
      page: 0,
    });
  const [changes, setChanges] = useState<Change[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    const abort = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      q: search.q,
      category: search.category,
      term: search.term,
      page: String(search.page),
    });
    void fetch(`/api/changes?${params}`, {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Change history is temporarily unavailable.');
        return response.json();
      })
      .then((data) => {
        if (active) {
          setChanges(data.changes);
          setMore(data.hasMore);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [open, search]);
  return (
    <details
      className="panel mx-auto my-3 max-w-7xl p-4 no-print"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">
        Academic catalog updates{' '}
        <span
          className="ml-2 text-xs font-normal"
          style={{ color: 'var(--muted)' }}
        >
          SQL revision {catalogRevision || '—'} ·{' '}
          {catalogPublishedAt
            ? new Date(catalogPublishedAt).toLocaleDateString()
            : ''}
        </span>
      </summary>
      <p className="mt-3 text-sm">
        Only committed, validated academic changes appear here. This is a
        planning catalog, not a record of your university registration.
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch({ q: query, category, term, page: 0 });
        }}
      >
        <label className="min-w-48 flex-1 text-xs">
          Course code or title
          <input
            className="select mt-1 w-full"
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search published changes"
          />
        </label>
        <label className="text-xs">
          Term
          <input
            className="select mt-1"
            value={term}
            maxLength={100}
            onChange={(e) => setTerm(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Change category
          <select
            className="select mt-1"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All changes</option>
            {[
              'course_added',
              'course_removed',
              'course_modified',
              'section_added',
              'section_removed',
              'section_modified',
              'metadata_modified',
            ].map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <button className="btn px-4 py-2" type="submit" disabled={loading}>
          Filter
        </button>
      </form>
      {loading ? (
        <p className="mt-3 text-sm" role="status">
          Loading confirmed changes…
        </p>
      ) : error ? (
        <p className="mt-3 text-sm" role="alert">
          {error}
        </p>
      ) : !changes.length ? (
        <p className="mt-3 text-sm">
          No published changes match these filters.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {changes.map((change) => (
            <li key={change.id}>
              <details className="panel-soft p-3">
                <summary className="cursor-pointer text-sm">
                  <b>{change.course_code || 'Catalog metadata'}</b>{' '}
                  {change.course_title} · {change.category.replace(/_/g, ' ')} ·{' '}
                  {new Date(change.published_at).toLocaleDateString()}
                </summary>
                <p className="mt-2 text-xs">
                  {change.section_key} · Fields: {change.fields.join(', ')}
                </p>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div>
                    <b className="text-xs">Previous</b>
                    <pre className="whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(change.before_value, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <b className="text-xs">Published</b>
                    <pre className="whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(change.after_value, null, 2)}
                    </pre>
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <button
          className="btn px-3 py-2 text-xs"
          disabled={loading || search.page === 0}
          onClick={() => setSearch((s) => ({ ...s, page: s.page - 1 }))}
        >
          Newer changes
        </button>
        <button
          className="btn px-3 py-2 text-xs"
          disabled={loading || !more}
          onClick={() => setSearch((s) => ({ ...s, page: s.page + 1 }))}
        >
          Older changes
        </button>
      </div>
    </details>
  );
}

/**
 * Dedicated catalog API reader. NO browser, DOM, clicks, login form submission,
 * arbitrary URLs, registration routes, screenshots, traces or account schedule data.
 * Live use requires an independently reviewed, version-controlled source contract.
 */
export class SourceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export const UNIVERSITY_ORIGIN = 'https://sisselfservice.zewailcity.edu.eg';
const forbidden =
  /(register|registration|enroll|enrolment|schedule|student|grades?|financial|drop|withdraw|delete|remove|submit|confirm|save|add)/i;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function validateContract(contract) {
  if (
    !contract ||
    contract.version !== 1 ||
    contract.approved !== true ||
    contract.format !== 'planora.catalog-page.v1'
  )
    throw new SourceError('SOURCE_CONTRACT_NOT_APPROVED');
  if (
    contract.origin !== UNIVERSITY_ORIGIN ||
    typeof contract.catalogPath !== 'string' ||
    !/^\/[a-zA-Z0-9/_-]+$/.test(contract.catalogPath) ||
    contract.catalogPath.includes('//') ||
    forbidden.test(contract.catalogPath) ||
    !/catalog/i.test(contract.catalogPath)
  )
    throw new SourceError('UNSAFE_SOURCE_ROUTE');
  if (
    !['bearer', 'basic'].includes(contract.authentication) ||
    typeof contract.term !== 'string' ||
    !/^[a-z0-9-]{1,100}$/.test(contract.term) ||
    typeof contract.reviewReference !== 'string' ||
    contract.reviewReference.length < 12 ||
    contract.reviewReference.startsWith('UNVERIFIED')
  )
    throw new SourceError('SOURCE_CONTRACT_NOT_APPROVED');
  return contract;
}
export function catalogRequest(contract, page, credentials) {
  validateContract(contract);
  if (!Number.isInteger(page) || page < 1 || page > 10000)
    throw new SourceError('PAGINATION_SAFETY_LIMIT_EXCEEDED');
  const url = new URL(contract.catalogPath, UNIVERSITY_ORIGIN);
  url.searchParams.set('term', contract.term);
  url.searchParams.set('page', String(page));
  let authorization;
  if (contract.authentication === 'bearer') {
    if (!credentials?.token || /[\r\n]/.test(credentials.token))
      throw new SourceError('SOURCE_CREDENTIALS_MISSING');
    authorization = `Bearer ${credentials.token}`;
  } else {
    if (
      !credentials?.username ||
      !credentials?.password ||
      credentials.username.includes(':')
    )
      throw new SourceError('SOURCE_CREDENTIALS_MISSING');
    authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
  }
  return {
    url: url.toString(),
    options: {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: authorization },
      signal: AbortSignal.timeout(20000),
    },
  };
}
async function jsonOnly(response) {
  if (response.status === 401)
    throw new SourceError('SOURCE_AUTHENTICATION_FAILED_OR_EXPIRED');
  if (response.status === 403)
    throw new SourceError('SOURCE_ACCESS_DENIED_OR_CHALLENGE');
  if (response.status >= 300 && response.status < 400)
    throw new SourceError('SOURCE_UNEXPECTED_REDIRECT');
  if (response.status === 404)
    throw new SourceError('SOURCE_CATALOG_NOT_FOUND');
  if (!response.ok) throw new SourceError('SOURCE_UNAVAILABLE');
  if (
    !/^application\/json(?:;|$)/i.test(
      response.headers.get('content-type') || ''
    )
  )
    throw new SourceError('SOURCE_STRUCTURE_CHANGED_OR_CHALLENGE');
  if (Number(response.headers.get('content-length')) > 2_000_000)
    throw new SourceError('SOURCE_PAGE_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) throw new SourceError('SOURCE_EMPTY_RESPONSE');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new SourceError('SOURCE_PAGE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SourceError('SOURCE_MALFORMED_JSON');
  }
}
const topKeys = [
  'format',
  'term',
  'snapshot',
  'page',
  'pageCount',
  'totalCourses',
  'totalSections',
  'complete',
  'courses',
  'sch',
];
const courseKeys = [
  'id',
  'code',
  'name',
  'c',
  'credits',
  'group',
  'noFixedSchedule',
  'awaitingSource',
  'sourceId',
  'instructors',
];
const groupKeys = [
  'name',
  'note',
  'unassigned',
  'lectures',
  'labs',
  'tutorials',
];
const meetingKeys = ['type', 'sec', 'day', 'start', 'end', 'room', 'sourceId'];
function exactObject(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((k) => keys.includes(k))
  );
}
/** Reject unknown/personal fields before returning a page to the worker. No page content is logged. */
function safeAcademicObjects(rows) {
  for (const c of rows) {
    if (
      !exactObject(c, courseKeys) ||
      typeof c.id !== 'string' ||
      typeof c.code !== 'string' ||
      !Array.isArray(c.instructors)
    )
      throw new SourceError('SOURCE_NON_ACADEMIC_OR_CHANGED_STRUCTURE');
    for (const i of c.instructors) {
      if (!exactObject(i, groupKeys))
        throw new SourceError('SOURCE_NON_ACADEMIC_OR_CHANGED_STRUCTURE');
      for (const b of ['lectures', 'labs', 'tutorials']) {
        if (!Array.isArray(i[b]))
          throw new SourceError('SOURCE_NON_ACADEMIC_OR_CHANGED_STRUCTURE');
        for (const m of i[b])
          if (!exactObject(m, meetingKeys))
            throw new SourceError('SOURCE_NON_ACADEMIC_OR_CHANGED_STRUCTURE');
      }
    }
  }
}
export async function collectCatalog({
  contract,
  credentials,
  fetchImpl = globalThis.fetch,
  wait = delay,
  onPage = async (_progress) => {},
}) {
  validateContract(contract);
  const dataset = { courses: [], sch: [] },
    seen = new Set();
  let expected = null,
    sections = 0,
    totalBytes = 0;
  for (let page = 1; ; page++) {
    // Limit is a FAIL condition, never a truncation/success condition.
    if (page > 10000) throw new SourceError('PAGINATION_SAFETY_LIMIT_EXCEEDED');
    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
      const request = catalogRequest(contract, page, credentials);
      try {
        const response = await fetchImpl(request.url, request.options);
        if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
          await response.body?.cancel();
          await wait(500 * 2 ** attempt);
          continue;
        }
        data = await jsonOnly(response);
        break;
      } catch (error) {
        if (error instanceof SourceError) throw error;
        if (attempt === 2) throw new SourceError('SOURCE_NETWORK_TIMEOUT');
        await wait(500 * 2 ** attempt);
      }
    }
    totalBytes += Buffer.byteLength(JSON.stringify(data), 'utf8');
    if (totalBytes > 20_000_000)
      throw new SourceError('SOURCE_CATALOG_TOO_LARGE');
    if (
      !exactObject(data, topKeys) ||
      data.format !== 'planora.catalog-page.v1' ||
      data.term !== contract.term ||
      data.complete !== true ||
      data.page !== page ||
      !Array.isArray(data.courses) ||
      !Array.isArray(data.sch)
    )
      throw new SourceError('SOURCE_INCOMPLETE_OR_CHANGED_STRUCTURE');
    if (
      !Number.isInteger(data.pageCount) ||
      data.pageCount < page ||
      data.pageCount > 10000 ||
      !Number.isInteger(data.totalCourses) ||
      data.totalCourses < 1 ||
      data.totalCourses > 100000 ||
      !Number.isInteger(data.totalSections) ||
      data.totalSections < 1 ||
      typeof data.snapshot !== 'string' ||
      !data.snapshot ||
      data.snapshot.length > 200
    )
      throw new SourceError('SOURCE_INVALID_COVERAGE');
    const meta = JSON.stringify([
      data.snapshot,
      data.pageCount,
      data.totalCourses,
      data.totalSections,
    ]);
    if (expected !== null && expected !== meta)
      throw new SourceError('SOURCE_CHANGED_DURING_PAGINATION');
    expected = meta;
    if (data.courses.length + data.sch.length === 0)
      throw new SourceError('SOURCE_EMPTY_PAGE');
    for (const catalog of ['courses', 'sch']) {
      safeAcademicObjects(data[catalog]);
      for (const course of data[catalog]) {
        const key = `${catalog}:${course.sourceId || course.id}`;
        if (seen.has(key)) throw new SourceError('SOURCE_DUPLICATE_COURSE');
        seen.add(key);
        sections += course.instructors.reduce(
          (n, i) => n + i.lectures.length + i.labs.length + i.tutorials.length,
          0
        );
        dataset[catalog].push(course);
      }
    }
    if (seen.size > data.totalCourses || sections > data.totalSections)
      throw new SourceError('SOURCE_COUNT_EXCEEDS_MANIFEST');
    await onPage({
      pagesRead: page,
      pageCount: data.pageCount,
      courses: seen.size,
      sections,
    });
    if (page === data.pageCount) {
      if (
        seen.size !== data.totalCourses ||
        sections !== data.totalSections ||
        !dataset.courses.length ||
        !dataset.sch.length
      )
        throw new SourceError('SOURCE_INCOMPLETE_CATALOG');
      return {
        dataset,
        coverage: {
          complete: true,
          term: contract.term,
          courses: seen.size,
          sections,
          pagesRead: page,
          pageCount: data.pageCount,
          snapshot: data.snapshot,
        },
      };
    }
    await wait(300);
  }
}

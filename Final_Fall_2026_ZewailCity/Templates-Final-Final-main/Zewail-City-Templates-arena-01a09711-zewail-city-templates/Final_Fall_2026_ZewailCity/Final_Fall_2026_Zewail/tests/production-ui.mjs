/** Execute the actual single-file build in a DOM, with only fixture-backed relative API requests. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { SourceTextModule } from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
const read = async (name) =>
  JSON.parse(
    await readFile(
      new URL(`../src/semester/${name}.json`, import.meta.url),
      'utf8'
    )
  );
const [courses, sch, majors, semester] = await Promise.all(
  ['courses', 'sch', 'majors', 'semester'].map(read)
);
const html = await readFile(
  new URL('../dist/index.html', import.meta.url),
  'utf8'
);
const code = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert(code, 'Expected the existing single-file build');
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => errors.push(e));
virtualConsole.on('error', (e) => errors.push(e));
const dom = new JSDOM(html, {
  url: 'https://planner.example.invalid',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole,
});
const win = dom.window;
const course = courses.find((c) => c.id === 'csai205'),
  meeting = course.instructors[0].lectures[0];
const key = [
  meeting.type,
  meeting.sec,
  meeting.day,
  meeting.start,
  meeting.end,
  meeting.room,
].join('|');
const raw = JSON.stringify({
  semesterKey: semester.key,
  majorId: 'it',
  yearId: 'y2',
  picks: { [course.id]: { Lecture: key, Lab: null, Tutorial: null } },
  instructorFilter: {},
});
const lockKey = `zc-planner-locks-v2:${semester.key}`;
win.localStorage.setItem('zw-app-state-v2', raw);
win.localStorage.setItem(
  lockKey,
  JSON.stringify({ courseIds: [course.id], components: {} })
);
win.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
win.TextEncoder = TextEncoder;
win.TextDecoder = TextDecoder;
let calls = 0;
win.fetch = async (input) => {
  assert.equal(
    String(input),
    '/api/catalog',
    'Boot must not send saved choices or call the university'
  );
  calls++;
  return new Response(
    JSON.stringify({
      courses,
      sch,
      majors,
      semester,
      revision: 7,
      publishedAt: '2026-10-14T00:00:00Z',
      hash: 'synthetic',
      schemaVersion: 1,
      source: 'postgresql',
    }),
    { status: 200 }
  );
};
try {
  const module = new SourceTextModule(code, {
    context: dom.getInternalVMContext(),
    initializeImportMeta: (meta) => {
      meta.url = 'https://planner.example.invalid/index.html';
    },
  });
  await module.link(() => {
    throw new Error('Unexpected external module in single-file build');
  });
  await module.evaluate();
  const end = Date.now() + 5000;
  while (
    !win.document.body.textContent.includes('Change year') &&
    Date.now() < end
  )
    await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(errors.length, 0, errors.map(String).join('\n'));
  assert.equal(calls, 1);
  assert(win.document.body.textContent.includes('CSAI 205'));
  assert(win.document.body.textContent.includes('Fall 2026'));
  assert.equal(
    JSON.parse(win.localStorage.getItem('zw-app-state-v2')).picks[course.id]
      .Lecture,
    key
  );
  assert.equal(
    win.localStorage.getItem(
      `planora-preserved-schedule:${semester.key}:before-7`
    ),
    raw
  );
  assert.equal(
    win.localStorage.getItem('zc-planner-locks-v2:'),
    null,
    'Production import inlining must not capture an empty term'
  );
  assert(
    JSON.parse(win.localStorage.getItem(lockKey)).courseIds.includes(course.id)
  );
  console.log(
    'Built student app: relative SQL fetch, hydrated term, saved plan, raw backup and term-scoped locks passed'
  );
} finally {
  win.close();
}

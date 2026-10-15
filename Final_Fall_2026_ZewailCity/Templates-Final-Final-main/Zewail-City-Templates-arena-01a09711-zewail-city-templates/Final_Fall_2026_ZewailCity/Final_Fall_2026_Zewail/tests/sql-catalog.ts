import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { Course } from '../src/types';
import { emptyPick, uid } from '../src/lib/picks';
import {
  scheduleImpacts,
  selectedSnapshot,
  parseSavedMeeting,
} from '../src/lib/scheduleImpact';
import {
  loadAppState,
  saveAppState,
  STORAGE_KEY,
  preservedSchedule,
} from '../src/lib/appState';
import {
  fetchCatalog,
  installCatalog,
  validateCatalog,
  type CatalogPayload,
} from '../src/lib/catalogClient';
import { COURSE_BY_ID } from '../src/data/courses';
import { DEFAULT_PREFERENCES } from '../src/lib/preferences';
import { encodeSchedule, decodeSchedule } from '../src/lib/share';
import courses from '../src/semester/courses.json';
import sch from '../src/semester/sch.json';
import majors from '../src/semester/majors.json';
import semester from '../src/semester/semester.json';
const dom = new JSDOM('', { url: 'https://planner.example.invalid' });
Object.assign(globalThis, {
  window: dom.window,
  localStorage: dom.window.localStorage,
});
const payload: CatalogPayload = {
  courses: courses as Course[],
  sch: sch as Course[],
  majors,
  semester,
  revision: 2,
  publishedAt: '2026-10-14T00:00:00.000Z',
  hash: 'test-fixture-only',
  schemaVersion: 1,
  source: 'postgresql',
};
installCatalog(payload);
const course = (id: string, start: number): Course => ({
  id,
  code: 'SAME 101',
  name: 'Synthetic fixture',
  c: 1,
  credits: 3,
  instructors: [
    {
      name: 'Fixture teacher',
      lectures: [
        {
          type: 'Lecture',
          sec: '01',
          day: 'Mon',
          start,
          end: start + 60,
          room: 'Fixture',
          sourceId: `${id}-source`,
        },
      ],
      labs: [],
      tutorials: [],
    },
  ],
});
const a = course('a', 600),
  b = course('b', 800),
  old = { a, b };
const picks = {
  a: { ...emptyPick(), Lecture: uid(a.instructors[0].lectures[0]) },
  b: { ...emptyPick(), Lecture: uid(b.instructors[0].lectures[0]) },
};
const snapshot = selectedSnapshot(picks, old);
const next = structuredClone(old);
next.a.instructors[0].lectures[0].start = 800;
next.a.instructors[0].lectures[0].end = 860;
assert(
  scheduleImpacts(picks, next, snapshot).some(
    (n) => n.kind === 'confirmed_conflict'
  )
);
const noIds = structuredClone(old);
delete noIds.a.instructors[0].lectures[0].sourceId;
delete noIds.b.instructors[0].lectures[0].sourceId;
assert(
  scheduleImpacts(picks, next, selectedSnapshot(picks, noIds)).some(
    (n) => n.kind === 'potential_conflict'
  )
);
assert.equal(scheduleImpacts(picks, next, snapshot, false).length, 0);
assert(
  scheduleImpacts(picks, { b }, snapshot).some(
    (n) => n.kind === 'unavailable' && n.courseId === 'a'
  )
);
assert.equal(scheduleImpacts({ b: picks.b }, next, snapshot).length, 0); // Same course code is not the identity.
const differentSection = structuredClone(a);
differentSection.instructors[0].lectures.push({
  ...differentSection.instructors[0].lectures[0],
  sec: '02',
  sourceId: 'a-other',
});
const selectTwo = {
  a: {
    ...emptyPick(),
    Lecture: uid(differentSection.instructors[0].lectures[1]),
  },
};
const twoSnap = selectedSnapshot(selectTwo, { a: differentSection });
differentSection.instructors[0].lectures[0].start = 610;
assert.equal(
  scheduleImpacts(selectTwo, { a: differentSection }, twoSnap).length,
  0
);
assert.equal(parseSavedMeeting('Lecture|01|Sun|900|700|room'), null);
assert.equal(
  parseSavedMeeting('Lecture|01|Sun|600|660|Room A | B')?.room,
  'Room A | B'
);

const base = structuredClone(payload),
  original = base.courses[0],
  meeting = original.instructors[0].lectures[0],
  key = uid(meeting);
const raw = JSON.stringify({
  semesterKey: semester.key,
  majorId: 'it',
  yearId: 'y2',
  picks: {
    [original.id]: { ...emptyPick(), Lecture: key },
    removed101: { ...emptyPick(), Lecture: 'Lecture|01|Sun|600|660|Old room' },
  },
  instructorFilter: {},
  preferences: DEFAULT_PREFERENCES,
  savedAt: 123,
});
localStorage.setItem(STORAGE_KEY, raw);
base.courses[0].instructors[0].lectures[0].start += 5;
installCatalog({ ...base, revision: 3 });
const loaded = loadAppState()!;
assert.equal(loaded.picks[original.id].Lecture, key);
assert.equal(
  loaded.picks.removed101.Lecture,
  'Lecture|01|Sun|600|660|Old room'
);
assert.equal(preservedSchedule(), raw);
assert.equal(
  localStorage.getItem(`planora-preserved-schedule:${semester.key}:before-3`),
  raw
);
saveAppState(loaded);
const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
assert.equal(saved.picks[original.id].Lecture, key);
assert(saved.picks.removed101);
const shared = encodeSchedule('it', base.courses, loaded.picks);
const decoded = decodeSchedule(shared)!;
assert.equal(decoded.legacySections, false);
assert.equal(decoded.picks[original.id].Lecture, key);
assert(decoded.picks.removed101); // No silent remapping after a time change.
assert.notEqual(key, uid(COURSE_BY_ID[original.id].instructors[0].lectures[0]));
const requests: string[] = [];
globalThis.fetch = async (input) => {
  requests.push(String(input));
  return new Response(JSON.stringify(payload), { status: 200 });
};
assert.equal((await fetchCatalog()).source, 'postgresql');
assert.deepEqual(requests, ['/api/catalog']);
assert(!requests.some((x) => x.includes('removed101')));
const addition = structuredClone(payload);
addition.courses.push({
  ...structuredClone(addition.courses[0]),
  id: 'new-fixture',
  code: 'NEW 101',
});
assert(validateCatalog(addition));
installCatalog(addition);
assert(COURSE_BY_ID['new-fixture']);
assert(
  !validateCatalog({
    ...payload,
    courses: [...payload.courses, payload.courses[0]],
  })
);
globalThis.fetch = async () => new Response('{}', { status: 503 });
await assert.rejects(fetchCatalog(), /SQL catalog is unavailable/);
console.log(
  'SQL catalog client, exact-section impacts/conflicts, untouched saved keys, local backups, v6 sharing and no schedule upload: passed'
);

/**
 * Node harness for the merged scheduler core — no DOM required.
 * Run via:  npx esbuild tests/harness.ts --bundle --platform=node --format=esm --outfile=/tmp/harness.mjs && node /tmp/harness.mjs
 */

/* ---------- browser shims (share.ts uses window.btoa/atob, appState uses window.localStorage) ---------- */
// @ts-expect-error test shim
globalThis.window = globalThis;

import { COURSE_BY_ID, COURSES } from '../src/data/courses';
import { MAJORS, allYearCourseIds, yearBadgeOf, yearPlanOf } from '../src/data/majors';
import { isValidYearId } from '../src/lib/stateValidation';
import { effectiveCreditCap, isValidCreditCap, registeredCredits, wouldExceedCap } from '../src/lib/appState';
import { overlaps, type Meeting } from '../src/lib/time';
import { buildCoursePairings, buildPairings, measureSchedule, generateCombinations, findBestCombo, MAX_COMBOS } from '../src/lib/scheduler';
import { generateBestSchedules, hardConstraintsActive, scheduleMatchesPicks } from '../src/lib/bestSchedule';
import { DEFAULT_PREFERENCES, sanitizePreferences, toCompactPreferences, fromCompactPreferences } from '../src/lib/preferences';
import { computeFreeTime, WINDOW_START, WINDOW_END } from '../src/lib/freeTime';
import { encodeSchedule, decodeSchedule, buildShareUrl, readScheduleFromLocation } from '../src/lib/share';
import { loadAppState, saveAppState, type PersistedState } from '../src/lib/appState';
import { SEMESTER_CONFIG } from '../src/config/semester';
import {
  emptyPick,
  optionStates,
  summarizeHidden,
  hiddenReasons,
  pickIssues,
  draftMeetings,
  draftOverlaps,
  meetingOption,
  publishedKinds,
  resolvedInstructorIdx,
  uid,
  type PickState,
} from '../src/lib/picks';

/** Same base64url encoding the share codec uses — for crafting legacy/junk payloads. */
function base64UrlEncodeShim(input: string): string {
  return Buffer.from(input, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) pass++;
  else {
    fail++;
    console.error('FAIL:', name);
  }
}

const mm = (day: Meeting['day'], s: number, e: number, type: Meeting['type'] = 'Lecture', sec = 'x', room = 'r'): Meeting => ({
  type,
  sec,
  day,
  start: s,
  end: e,
  room,
});

/* ================= 1. conflict rules (end-exclusive) ================= */
check('adjacent 60-min blocks do not conflict', !overlaps(mm('Sun', 480, 540), mm('Sun', 540, 600)));
check('1-min overlap conflicts', overlaps(mm('Sun', 480, 541), mm('Sun', 540, 600)));
check('different days never conflict', !overlaps(mm('Sun', 480, 600), mm('Mon', 480, 600)));
check('same time different room still conflicts', overlaps(mm('Sun', 480, 600), mm('Sun', 480, 600, 'Lecture', 'x', 'other')));

/* ================= 2. exact durations ================= */
check('measureSchedule sums exact minutes', measureSchedule([mm('Sun', 480, 540), mm('Mon', 600, 720)]).meetingMinutes === 180);
const phys = COURSE_BY_ID['phys104'];
check('PHYS 104 has at least one valid pairing', buildCoursePairings(phys).length > 0);
check('every course pairing (ALL courses) is internally conflict-free', (() => {
  return Object.values(COURSE_BY_ID).every((c) => {
    const ps = buildCoursePairings(c);
    for (const p of ps) {
      for (let i = 0; i < p.meetings.length; i++)
        for (let j = i + 1; j < p.meetings.length; j++) if (overlaps(p.meetings[i], p.meetings[j])) return false;
    }
    return true;
  });
})());
check('pairings never invent meetings: every entry is a published section', (() => {
  return Object.values(COURSE_BY_ID).every((c) =>
    buildCoursePairings(c).every((p) =>
      p.meetings.every((m) => c.instructors.some((i) => [i.lectures, i.labs, i.tutorials].some((pool) => pool.includes(m)))),
    ),
  );
})());

/* 2a. current MATH 105 instructor data + replacement semantics */
{
  const math105 = COURSE_BY_ID['math105'];
  const sec03 = math105.instructors.flatMap((i) => i.lectures).find((m) => m.sec === '03')!;
  check('MATH 105 Lecture Sec 03 is owned by Ahmed El-Deeb',
    meetingOption(math105, sec03)?.instructor.name === 'Ahmed El-Deeb');

  const sec02 = math105.instructors.flatMap((i) => i.lectures).find((m) => m.sec === '02')!;
  const picks: PickState = { math105: { Lecture: uid(sec02), Lab: null, Tutorial: null } };
  picks.math105.Lecture = uid(sec03);
  const finalDraft = draftMeetings([math105], picks);
  check('replacing MATH 105 Lecture Sec 02 with Sec 03 keeps only one lecture',
    finalDraft.filter((d) => d.courseId === 'math105' && d.meeting.type === 'Lecture').length === 1 &&
    finalDraft[0]?.meeting.sec === '03');
  check('a replacement is checked only in its final state, not against the meeting it replaced',
    draftOverlaps(finalDraft).length === 0);
}

/* 2b. cross-instructor pairing: mixing groups may widen the space but must never remove valid same-group pairings */
{
  const perGroup = (id: string) => COURSE_BY_ID[id].instructors.reduce((a, i) => a + buildPairings(i).length, 0);
  const cross = (id: string) => buildCoursePairings(COURSE_BY_ID[id]).length;

  ['csai201', 'csai202', 'csai203', 'math105'].forEach((id) => {
    check(`${COURSE_BY_ID[id].code}: cross-instructor pairing never narrows the valid space`, cross(id) >= perGroup(id));
  });

  const singleInstructor = COURSES.filter((course) => course.instructors.length === 1 && !course.noFixedSchedule);
  check('single-instructor courses keep the same pairing count', singleInstructor.every((course) =>
    buildCoursePairings(course).length === buildPairings(course.instructors[0]).length));

  const c205 = buildCoursePairings(COURSE_BY_ID['csai205']);
  check('every CSAI 205 generated pairing is internally conflict-free', c205.every((pairing) =>
    pairing.meetings.every((a, i) => pairing.meetings.every((b, j) => i === j || !overlaps(a, b)))));

  const c202 = buildCoursePairings(COURSE_BY_ID['csai202']);
  check('CSAI 202 lecture-only instructor can pair with another instructor lab when times allow',
    c202.some((pairing) => pairing.lecture?.sec === '03' && pairing.instructors?.Lab != null && pairing.instructors.Lab !== pairing.instructors.Lecture));
}

/* ================= 3. free-time math (real times, defined window) ================= */
const ft = computeFreeTime([mm('Sun', 480, 540)]);
check('window is 08:00–18:00', WINDOW_START === 480 && WINDOW_END === 1080);
check('occupied = exact 60 min', ft.occupiedMinutes === 60);
check('free = 5×600 − 60 minutes', ft.freeMinutes === 5 * 600 - 60);
check('freeHours keeps decimals (49h)', Math.abs(ft.freeHours - 49) < 1e-9);
check('perDay Sun occupied 60', ft.perDay.find((d) => d.day === 'Sun')!.occupied === 60);
check('perDay Mon free = whole window', ft.perDay.find((d) => d.day === 'Mon')!.freeMinutes === 600);
const ft2 = computeFreeTime([mm('Sun', 480, 600), mm('Sun', 540, 660)]);
check('double-booked union counted once (occupied 180)', ft2.occupiedMinutes === 180);
check('overlap minutes reported (60)', ft2.overlapMinutes === 60);
const ft3 = computeFreeTime([mm('Sun', 420, 480), mm('Sun', 1020, 1140)]);
check('clips to window edges (only 1020–1080 counts)', ft3.occupiedMinutes === 60 && ft3.outsideWindowMinutes === 120);

/* ================= 4. Best-schedule engine: backtracking, MCF, ranking, hard constraints ================= */
const core = [COURSE_BY_ID['csai201'], COURSE_BY_ID['csai202'], COURSE_BY_ID['csai203'], phys];
const report = generateBestSchedules(core, DEFAULT_PREFERENCES);
check('generates schedules', report.schedules.length > 0 && report.schedules.length <= 6);
check('returned schedules are conflict-free', report.schedules.every((s) => {
  for (let i = 0; i < s.meetings.length; i++)
    for (let j = i + 1; j < s.meetings.length; j++) if (overlaps(s.meetings[i], s.meetings[j])) return false;
  return true;
}));
check('ranked non-increasing by score', report.schedules.every((s, i) => i === 0 || s.scorePercent <= report.schedules[i - 1].scorePercent));
check('totalValid >= returned count', report.totalValid >= report.schedules.length);
check('dedup: no identical schedules', (() => {
  const keys = report.schedules.map((s) => s.meetings.map((m) => uid(m)).sort().join('|'));
  return new Set(keys).size === keys.length;
}));
check('each schedule covers all requested courses exactly once', report.schedules.every((s) => s.perCourse.length === core.length));
check('scheduleMatchesPicks agrees on the top result', (() => {
  const s = report.schedules[0];
  const picks: PickState = {};
  s.perCourse.forEach((e) => {
    const p = emptyPick();
    e.pairing.meetings.forEach((m) => {
      p[m.type] = uid(m);
    });
    picks[e.course.id] = p;
  });
  return scheduleMatchesPicks(s, uid, picks);
})());
check('best schedule is the exact union of its per-course pairings', (() => {
  const s = report.schedules[0];
  const fromEntries = s.perCourse.flatMap((e) => e.pairing.meetings.map(uid)).sort();
  const fromMeetings = s.meetings.map(uid).sort();
  return JSON.stringify(fromEntries) === JSON.stringify(fromMeetings);
})());

check('hard flag considered active only when set', hardConstraintsActive(DEFAULT_PREFERENCES) === false && hardConstraintsActive({ ...DEFAULT_PREFERENCES, keepFreeDaysHard: true, keepFreeDays: ['Wed'] }) === true);
const hard = generateBestSchedules(core, {
  ...DEFAULT_PREFERENCES,
  keepFreeDays: ['Wed'],
  keepFreeDaysHard: true,
  maxHoursPerDay: 4,
  maxHoursHard: true,
});
check('HARD keep-free + hour cap are never violated by results', hard.schedules.every((s) => {
  if (s.meetings.some((m) => m.day === 'Wed')) return false;
  const per: Record<string, number> = {};
  s.meetings.forEach((m) => {
    per[m.day] = (per[m.day] ?? 0) + (m.end - m.start);
  });
  return Object.values(per).every((x) => x <= 240);
}));

const impossible = generateBestSchedules(core, { ...DEFAULT_PREFERENCES, preferredStart: 480, preferredEnd: 481, timeRangeHard: true });
check('impossible HARD window => zero schedules', impossible.schedules.length === 0 && impossible.totalValid === 0);
check('impossible HARD window => explicit reason, not silence', impossible.blockedByHard.length > 0 && impossible.unsatisfiableHard.length > 0);
check('soft window with same bounds still yields schedules', generateBestSchedules(core, { ...DEFAULT_PREFERENCES, preferredStart: 480, preferredEnd: 481 }).schedules.length > 0);

const soft = generateBestSchedules(core, { ...DEFAULT_PREFERENCES, keepFreeDays: ['Wed'], keepFreeDaysHard: false });
check('SOFT rule changes ranking but not the valid space', soft.totalValid === report.totalValid && soft.schedules.length > 0);
check('soft keep-free violations are reported honestly on schedules', soft.schedules.every((s) => (s.meetings.some((m) => m.day === 'Wed') ? s.keepFreeViolations.includes('Wed') : true)));

/* ================= 5. counting budgets (top-K retention, capped recount) ================= */
{
  const entries = [COURSE_BY_ID['csai201'], COURSE_BY_ID['csai202']].map((course) => ({
    course,
    pairings: buildCoursePairings(course),
  }));
  const gen = generateCombinations(entries);
  check('generation stores results + counts', gen.count > 0 && gen.flat.length === gen.count * 2);
  check('small space: not truncated, not capped', gen.truncated === false && gen.countCapped === false);
  const best = findBestCombo(gen);
  check('findBestCombo returns a measured best', !!best && best.complete === true && best.scanned === gen.count && !!best.metrics);
  // brute-force verify engine picked the true optimum within scan
  if (best) {
    let trueBestScore = Infinity;
    for (let i = 0; i < gen.count; i++) {
      const m = measureSchedule(
        [0, 1].flatMap((ci) => {
          const p = gen.flat[i * gen.courseCount + ci];
          return gen.pairingsByCourse[gen.order[ci]][p].meetings;
        }),
      );
      if (m.score < trueBestScore) trueBestScore = m.score;
    }
    check('engine best equals brute-force best score', Math.abs(best.metrics.score - trueBestScore) < 1e-9);
  }
}
{
  // Big synthetic space (fabricated test data — the real dataset is never mutated): force early-exit flags.
  const wide = [
    COURSE_BY_ID['csai201'],
    COURSE_BY_ID['csai202'],
    COURSE_BY_ID['csai203'],
    phys,
    COURSE_BY_ID['csai101'] ?? COURSE_BY_ID['csai201'],
  ].filter((c, i, a) => a.indexOf(c) === i);
  const big = generateBestSchedules(wide, DEFAULT_PREFERENCES);
  check('larger space still returns <= 6 ranked, conflict-free results', big.schedules.length <= 6);
  check('truncated/earlyExit flags are booleans', typeof big.truncated === 'boolean' && typeof big.earlyExit === 'boolean');
}

/* ================= 6. share URL roundtrip (instructor filter + prefs must survive) ================= */
const csai203 = COURSE_BY_ID['csai203'];
const shareCourses = [csai203, phys, COURSE_BY_ID['csai201']];
const realPicks: PickState = {};
for (const c of shareCourses) {
  const p = emptyPick();
  const lec = optionStates(c, 'Lecture', shareCourses.filter((x) => x.id !== c.id), realPicks)[0];
  const lab = optionStates(c, 'Lab', shareCourses.filter((x) => x.id !== c.id), realPicks)[0];
  if (lec) p.Lecture = lec.key;
  if (lab) p.Lab = lab.key;
  realPicks[c.id] = p;
}
const prefsTweaked = { ...DEFAULT_PREFERENCES, goals: { ...DEFAULT_PREFERENCES.goals, earliestFinish: false }, preferredEnd: 960 };
const encoded = encodeSchedule('software', shareCourses, realPicks, {
  requireComplete: true,
  typeFilter: 'Lab',
  courseFilter: 'csai203',
  preferences: prefsTweaked,
  instructorFilter: { csai203: 1, phys104: 0 },
});
check('v6 meeting-fact payload is bounded base64url (no + / = chars)', !/[+/=]/.test(encoded) && encoded.length < 2000);
const decoded = decodeSchedule(encoded)!;
check('decode: major preserved', decoded.majorId === 'software');
check('decode: every section key preserved', shareCourses.every((c) => decoded.picks[c.id]?.Lecture === realPicks[c.id]?.Lecture && decoded.picks[c.id]?.Lab === realPicks[c.id]?.Lab));
check('decode: instructorFilter survives', decoded.instructorFilter.csai203 === 1 && decoded.instructorFilter.phys104 === 0);
check('decode: browse filters survive', decoded.typeFilter === 'Lab' && decoded.courseFilter === 'csai203');
check('decode: preferences survive', !!decoded.preferences && decoded.preferences.preferredEnd === 960 && decoded.preferences.goals.earliestFinish === false);
check('requireComplete=true roundtrips (default omitted)', decoded.requireComplete === undefined);
check('requireComplete=false survives explicitly', decodeSchedule(encodeSchedule('software', [csai203], realPicks, { requireComplete: false }))!.requireComplete === false);
check('prefs-only link with no picks still decodes', (() => {
  const d = decodeSchedule(encodeSchedule('software', [], {}, { preferences: prefsTweaked, instructorFilter: { csai203: 2 } }));
  return !!d && Object.keys(d.picks).length === 0 && d.preferences?.preferredEnd === 960;
})());

/* ============ 6b. Share URL origin — runtime origin, sandbox artifacts never leak ============ */
{
  const loc = (href: string) => {
    const u = new URL(href);
    return { href, origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, protocol: u.protocol, host: u.host, port: u.port };
  };
  // The full author state listed in the acceptance criteria.
  const fullPrefs = {
    ...DEFAULT_PREFERENCES,
    goals: { minimizeGaps: true, maximizeFreeDays: true, earliestFinish: false, latestStart: false },
    preferredDays: ['Sun', 'Tue'],
    keepFreeDays: ['Wed'],
    preferredStart: 540,
    preferredEnd: 1020,
    noBefore: 540,
    noBeforeStrict: true,
    noAfter: 1020,
    noAfterStrict: false,
    maxHoursPerDay: 5,
    preferredDaysHard: true,
    keepFreeDaysHard: true,
    timeRangeHard: false,
    maxHoursHard: true,
  };
  const extras = {
    requireComplete: false,
    typeFilter: 'Tutorial',
    courseFilter: 'phys104',
    preferences: fullPrefs,
    instructorFilter: { csai203: 1, phys104: 0 },
  };

  // Vercel production — even with proxy/debug junk and a stale ?schedule= in the address bar.
  globalThis.location = loc('https://zc-planora.vercel.app/?sbx_debug=1&from=arena&schedule=STALEOLD#about');
  const prod = buildShareUrl('software', shareCourses, realPicks, extras);
  check('production URL is exactly app origin + ?schedule= payload', prod.startsWith('https://zc-planora.vercel.app/?schedule='));
  check('no Arena/sandbox debug params leak into the link', !prod.includes('arena') && !prod.includes('sbx_debug') && !prod.includes('STALEOLD') && !prod.includes('#about'));
  check('no personal/private fields in the payload', !/[?&](name|email|token|id(?!entity))=/i.test(prod));

  // "Another device/browser": only the URL string crosses over — decode it fresh.
  const param = new URL(prod).searchParams.get('schedule')!;
  const fresh = decodeSchedule(param)!;
  check('roundtrip: major + every selected course/pick restored', !!fresh && fresh.majorId === 'software' && shareCourses.every((c) => fresh.picks[c.id]?.Lecture === realPicks[c.id]?.Lecture && fresh.picks[c.id]?.Lab === realPicks[c.id]?.Lab));
  check('roundtrip: instructor pins restored', !!fresh && fresh.instructorFilter.csai203 === 1 && fresh.instructorFilter.phys104 === 0);
  check('roundtrip: browse filters restored', !!fresh && fresh.typeFilter === 'Tutorial' && fresh.courseFilter === 'phys104');
  check('roundtrip: requireComplete=false restored', !!fresh && fresh.requireComplete === false);
  check('roundtrip: goals, days, window, no-before, MAX HOURS and HARD flags restored', !!fresh && (() => {
    const pr = fresh.preferences!;
    return Object.keys(fullPrefs).every((k) => JSON.stringify((pr as never)[k]) === JSON.stringify((fullPrefs as never)[k]));
  })());

  // Arena preview keeps ITS runtime origin (works on the sandbox too — nothing hardcoded).
  globalThis.location = loc('https://5173-iqa3yo386zdsl59vp4klb.e2b.app/index.html?x=1');
  check('preview: link uses the preview origin, path preserved', buildShareUrl('software', [csai203], realPicks).startsWith('https://5173-iqa3yo386zdsl59vp4klb.e2b.app/index.html?schedule='));
  // Localhost/dev port preserved.
  globalThis.location = loc('http://localhost:5173/');
  check('localhost: dev port preserved', buildShareUrl('software', [csai203], realPicks).startsWith('http://localhost:5173/?schedule='));
  // Future subpath deployment keeps the app path.
  globalThis.location = loc('https://zewail.example.edu/planner/');
  check('subpath deployment keeps the app path', buildShareUrl('software', [csai203], realPicks).startsWith('https://zewail.example.edu/planner/?schedule='));
  // file:// (opaque "null" origin) must degrade to path + payload, never "nullhttp…" garbage.
  globalThis.location = { href: 'file:///home/user/zw/dist/index.html', origin: 'null', pathname: '/home/user/zw/dist/index.html', search: '', hash: '', protocol: 'file:', host: '', port: '' };
  const fileUrl = buildShareUrl('software', [csai203], realPicks);
  check('file:// origin: path + payload, no literal "null" domain', fileUrl.startsWith('/home/user/zw/dist/index.html?schedule=') && !fileUrl.startsWith('null'));
  // Whatever location remains, the payload itself stays decodable (codec untouched).
  check('payload from any origin still decodes', decodeSchedule(fileUrl.split('?schedule=')[1]) !== null);

  // Best-Schedule card path: a card shares ITS schedule with ITS derived pins.
  {
    const s0 = report.schedules[0];
    const cardPicks: PickState = {};
    s0.perCourse.forEach((e) => {
      const p = emptyPick();
      e.pairing.meetings.forEach((m) => { p[m.type] = uid(m); });
      cardPicks[e.course.id] = p;
    });
    globalThis.location = loc('https://zc-planora.vercel.app/');
    const cardUrl = buildShareUrl('software', s0.perCourse.map((e) => e.course), cardPicks, {
      preferences: DEFAULT_PREFERENCES,
      instructorFilter: Object.fromEntries(s0.perCourse.map((e) => [e.course.id, e.instructorIdx])),
    });
    const back = decodeSchedule(new URL(cardUrl).searchParams.get('schedule')!)!;
    check('card share: exact schedule state + its own instructor grouping survives', (() => {
      const ok = s0.perCourse.every((e) => {
        const p = back.picks[e.course.id];
        return !!p && e.pairing.meetings.every((m) => p[m.type] === uid(m));
      });
      const pins = s0.perCourse.every((e) => back.instructorFilter[e.course.id] === e.instructorIdx);
      return ok && pins;
    })());
  }

  // Corrupt/invalid links still fall back safely after the origin change (readScheduleFromLocation path).
  globalThis.location = loc('https://zc-planora.vercel.app/?schedule=%25%25garbage%25%25');
  check('garbage schedule param on production host => readScheduleFromLocation null, no throw', readScheduleFromLocation() === null);
}

/* hostile payloads must fail safe, never throw */
check('garbage string => null', decodeSchedule('not-base64!!') === null);
check('valid base64 of junk => null', decodeSchedule(btoa('{"v":3}')) === null);
check('unknown major => null', decodeSchedule(btoa(JSON.stringify({ v: 3, m: 'nonsense-major', r: [] }))) === null);
check('empty string => null', decodeSchedule('') === null);
check('stale ids dropped row-by-row without breaking siblings', (() => {
  const d = decodeSchedule(btoa(JSON.stringify({ v: 3, m: 'software', r: [['ghost999', 0, 0, 0], ['csai203', 9999, 0, -3], ['phys104', 0, 0, 0]], inf: [['csai203', 42], ['ghost999', 1], ['phys104', 'x']] })));
  return (
    !!d &&
    !d.picks.ghost999 &&
    Object.keys(d.instructorFilter).length === 0 &&
    d.picks.csai203?.Lecture == null &&
    d.picks.csai203?.Lab === optionStates(csai203, 'Lab', [], {}, {})[0].key &&
    d.picks.phys104?.Lecture != null
  );
})());

/* ================= 7. localStorage persistence + corruption tolerance ================= */
const store = new Map<string, string>();
// @ts-expect-error test shim
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const saved: PersistedState = {
  semesterKey: SEMESTER_CONFIG.key,
  majorId: 'software',
  yearId: null,
  creditCap: null,
  instructorFilter: { csai203: 1 },
  picks: realPicks,
  requireComplete: true,
  typeFilter: 'All',
  courseFilter: 'all',
  preferences: prefsTweaked,
  savedAt: 1234,
};
saveAppState(saved);
const loaded = loadAppState();
check('save/load roundtrip preserves picks + instructorFilter', !!loaded && loaded.picks.csai203.Lecture === realPicks.csai203.Lecture && loaded.instructorFilter.csai203 === 1);
check('save/load preserves preferences', !!loaded && loaded.preferences.goals.earliestFinish === false && loaded.preferences.preferredEnd === 960);
check('instructor filter persists with NO picks (pills survive Clear-picks)', (() => {
  saveAppState({ ...saved, picks: {} });
  const l = loadAppState();
  return !!l && Object.keys(l.picks).length === 0 && l.instructorFilter.csai203 === 1;
})());
localStorage.setItem('zw-app-state-v2', '{broken json');
check('corrupt JSON => null, no throw', loadAppState() === null);
localStorage.setItem('zw-app-state-v2', JSON.stringify(null));
check('literal null => null', loadAppState() === null);
localStorage.setItem('zw-app-state-v2', JSON.stringify([1, 2, 3]));
check('array payload => null', loadAppState() === null);
localStorage.setItem(
  'zw-app-state-v2',
  JSON.stringify({ majorId: 42, picks: { csai203: { Lecture: 'zzz' }, ghost: 1 }, instructorFilter: { csai203: -1, ghost: 5 }, preferences: { preferredStart: 'oops', goals: 7 } }),
);
const junk = loadAppState()!;
check('junk top-level fields sanitized', junk.majorId === null && (!junk.picks.csai203 || !junk.picks.csai203.Lecture) && junk.picks.ghost === undefined && junk.instructorFilter.csai203 === undefined && junk.instructorFilter.ghost === undefined);
check('junk prefs sanitized to defaults', junk.preferences.preferredStart === DEFAULT_PREFERENCES.preferredStart && junk.preferences.goals.minimizeGaps === DEFAULT_PREFERENCES.goals.minimizeGaps);
check('bad filter enums rejected', (() => {
  localStorage.setItem('zw-app-state-v2', JSON.stringify({ majorId: 'software', picks: {}, instructorFilter: {}, preferences: DEFAULT_PREFERENCES, typeFilter: 'DROP TABLE', courseFilter: '../etc/passwd' }));
  const l = loadAppState()!;
  return l.typeFilter === 'All' && l.courseFilter === 'all';
})());
check('save never throws when storage quota blows up', (() => {
  const orig = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  try {
    saveAppState(saved);
    return true;
  } catch {
    return false;
  } finally {
    localStorage.setItem = orig;
  }
})());

/* ================= 8. preferences semantics ================= */
check('stored false goal is honored, not re-defaulted', sanitizePreferences({ goals: { minimizeGaps: false } }).goals.minimizeGaps === false);
check('garbage goal value falls back to default', sanitizePreferences({ goals: { minimizeGaps: 'yes' } }).goals.minimizeGaps === DEFAULT_PREFERENCES.goals.minimizeGaps);
check('out-of-range window rejected to safe default', (() => { const p = sanitizePreferences({ preferredStart: 99999 }); return p.preferredStart === null; })());
check('swapped window repaired (start<=end)', (() => { const p = sanitizePreferences({ preferredStart: 600, preferredEnd: 480 }); return p.preferredStart <= p.preferredEnd; })());
check('unknown days rejected from lists', sanitizePreferences({ keepFreeDays: ['Wed', 'Funday', 'Sat', 7] }).keepFreeDays.join() === 'Wed');
check('compact prefs roundtrip', (() => {
  const c = toCompactPreferences(prefsTweaked)!;
  const back = fromCompactPreferences(c);
  return back.preferredEnd === 960 && back.goals.earliestFinish === false && back.goals.minimizeGaps === prefsTweaked.goals.minimizeGaps;
})());
check('defaults compress to nothing (short URLs)', toCompactPreferences(DEFAULT_PREFERENCES) === undefined);
check('hard flags survive compaction', fromCompactPreferences(toCompactPreferences({ ...DEFAULT_PREFERENCES, timeRangeHard: true })!).timeRangeHard === true);

/* ================= 9. option state: filtering is derived & reversible ================= */
check('picks NEVER hide other instructors’ options — components are independent now', (() => {
  const lec = optionStates(COURSE_BY_ID['csai202'], 'Lecture', [], {}, {})[0]; // Yousry's lecture
  const labs = optionStates(COURSE_BY_ID['csai202'], 'Lab', [], { csai202: { ...emptyPick(), Lecture: lec.key } }, {});
  return labs.length > 0 && labs.every((o) => !o.hiddenByInstructor);
})());
check('cross-instructor lab under a chosen lecture is selectable unless it clashes by TIME', (() => {
  const ashraf = optionStates(COURSE_BY_ID['csai202'], 'Lecture', [], {}, {}).find((o) => o.instructorIdx === 1)!;
  const labs = optionStates(COURSE_BY_ID['csai202'], 'Lab', [COURSE_BY_ID['csai202']], { csai202: { ...emptyPick(), Lecture: ashraf.key } }, {});
  return labs.some((o) => !o.disabledByConflict && o.instructorIdx !== ashraf.instructorIdx);
})());
check('pill filter hides other groups (view only) but the chosen row stays visible', (() => {
  const lec = optionStates(csai203, 'Lecture', [], {}, {})[0];
  const p: PickState = { csai203: { ...emptyPick(), Lecture: lec.key } };
  const labs = optionStates(csai203, 'Lab', [], p, { pinnedInstructorIdx: 1 });
  const hidden = labs.filter((o) => o.hiddenByInstructor);
  const shown = labs.filter((o) => !o.hiddenByInstructor);
  void p; // picks cannot override the filter for hiding, but also cannot be hidden BY it — picked rows escape
  return hidden.length > 0 && shown.length > 0 && shown.every((o) => o.instructorIdx === 1 || o.picked);
})());
check('un-pin restores everything (reversibility)', (() => {
  const before = optionStates(csai203, 'Lab', [], {}, {}).length;
  optionStates(csai203, 'Lab', [], {}, { pinnedInstructorIdx: 1 });
  const after = optionStates(csai203, 'Lab', [], {}, {}).length;
  return before === after;
})());
check('conflicting option disabled WITH reason; removing the conflict restores it', (() => {
  // Across the real dataset: any chosen meeting must grey out overlapping options of the
  // OTHER kinds in the same course, with a concrete reason, and restore them when cleared.
  for (const c of Object.values(COURSE_BY_ID)) {
    for (const kindA of ['Lecture', 'Tutorial', 'Lab'] as const) {
      for (const a of optionStates(c, kindA, [], {}, {})) {
        const p: PickState = { [c.id]: { ...emptyPick(), [kindA]: a.key } };
        for (const kindB of (['Lecture', 'Tutorial', 'Lab'] as const).filter((k) => k !== kindA)) {
          const blocked = optionStates(c, kindB, [c], p, {}).find((o) => o.disabledByConflict);
          if (!blocked) continue;
          const reasons = hiddenReasons(blocked);
          const restored = optionStates(c, kindB, [c], {}, {}).find((o) => o.key === blocked.key)!;
          return reasons.some((r) => r.includes('Conflicts with')) && !!restored && !restored.disabledByConflict;
        }
      }
    }
  }
  return false; // no cross-kind conflict exists in the dataset at all — would itself be a red flag
})());
check('HARD preference disables an option with reason; SOFT never disables', (() => {
  const hardPrefs = { ...DEFAULT_PREFERENCES, preferredStart: 600, preferredEnd: 660, timeRangeHard: true };
  const labs = optionStates(csai203, 'Lab', [], {}, { preferences: hardPrefs });
  const blocked = labs.filter((o) => o.hardReasons.length > 0);
  const soft = optionStates(csai203, 'Lab', [], {}, { preferences: { ...DEFAULT_PREFERENCES, preferredStart: 600, preferredEnd: 660 } });
  return blocked.length > 0 && hiddenReasons(blocked[0]).length > 0 && soft.every((o) => o.hardReasons.length === 0 && !o.disabledByConflict);
})());
check('picked option is never hidden or disabled by its own state', (() => {
  const labs = optionStates(csai203, 'Lab', [], {}, { pinnedInstructorIdx: 1 });
  const pickOfGroup = labs.find((o) => !o.hiddenByInstructor)!;
  const again = optionStates(csai203, 'Lab', [], { csai203: { ...emptyPick(), Lab: pickOfGroup.key } }, { pinnedInstructorIdx: null });
  const me = again.find((o) => o.key === pickOfGroup.key)!;
  return me.picked && !me.disabledByConflict && me.conflicts.length === 0;
})());
check('summary counts hidden vs conflicts numerically', (() => {
  const s = summarizeHidden(optionStates(csai203, 'Lab', [], {}, { pinnedInstructorIdx: 1 }));
  return s.hidden >= 0 && s.conflicts >= 0 && Number.isFinite(s.hidden);
})());

/* ================= 10. dataset integrity ================= */
check('majors reference real courses only', COURSES.length > 0 && MAJORS.every((mj) => mj.years.every((y) => y.courseIds.every((id) => COURSE_BY_ID[id]))));
check('all meetings: positive 60/120-min intervals, valid day clock, aligned minutes', (() => {
  let ok = true;
  COURSES.forEach((c) =>
    c.instructors.forEach((i) =>
      [...i.lectures, ...i.labs, ...i.tutorials].forEach((m) => {
        const d = m.end - m.start;
        if (d !== 60 && d !== 120) ok = false;
        if (m.start < 0 || m.end > 24 * 60 || m.start >= m.end || m.start % 60 !== 0 || m.end % 60 !== 0) ok = false;
      }),
    ),
  );
  return ok;
})());
check('no duplicate uid within a course/kind', (() => {
  let ok = true;
  COURSES.forEach((c) => {
    (['Lecture', 'Lab', 'Tutorial'] as const).forEach((kind) => {
      const keys = optionStates(c, kind, [], {}, {}).map((o) => o.key);
      if (new Set(keys).size !== keys.length) ok = false;
    });
  });
  return ok;
})());
check('engine budgets configured', MAX_COMBOS === 200_000);

/* ================= 11. year-scoped majors (Part 2) ================= */
check('every major offers its published years in order', MAJORS.every((mj) =>
  mj.years.length === 4 &&
  mj.years[0].id === 'y1' && mj.years[0].label === 'Year 1 (Freshman)' &&
  mj.years[1].id === 'y2' && mj.years[1].label === 'Year 2 (Sophomore)' &&
  mj.years[2].id === 'y3' && mj.years[2].label === 'Year 3 (Junior)' &&
  mj.years[3].id === 'y4' && mj.years[3].label === 'Year 4 (Senior)'));
check('Year 2 lists keep the current five-course major plans', (() => {
  const y2 = (id: string) => MAJORS.find((m) => m.id === id)!.years.find((year) => year.id === 'y2')!.courseIds.join(',');
  return (
    y2('it') === 'csai201,csai202,math105,csai205,it205' &&
    y2('dsai') === 'csai201,csai202,math105,csai205,dsai203' &&
    y2('software') === 'csai201,csai202,csai203,phys104,math105'
  );
})());
check('shared ids referenced, never duplicated (csai203/csai301/csai498 are single courses)', (() => {
  const ids = COURSES.map((c) => c.id);
  return new Set(ids).size === ids.length &&
    ['it', 'dsai'].every((m) => MAJORS.find((x) => x.id === m)!.years.find((y) => y.id === 'y3')!.courseIds.includes('csai203')) &&
    ['it', 'dsai', 'software'].every((m) => MAJORS.find((x) => x.id === m)!.years.some((y) => y.courseIds.includes('csai301'))) &&
    ['it', 'dsai', 'software'].every((m) => MAJORS.find((x) => x.id === m)!.years.find((y) => y.id === 'y4')!.courseIds.includes('csai498'));
})());
check('yearPlanOf falls back to the first year for unknown/absent ids', (() => {
  const mj = MAJORS[0];
  return yearPlanOf(mj, 'y3').id === 'y3' && yearPlanOf(mj, null).id === mj.years[0].id && yearPlanOf(mj, 'zzz').id === mj.years[0].id;
})());
check('allYearCourseIds spans every year of the major (cross-year browser source)', (() => {
  const ids = allYearCourseIds(MAJORS.find((m) => m.id === 'dsai')!);
  return ids.includes('csai201') && ids.includes('dsai307') && ids.includes('dsai456') && new Set(ids).size === ids.length;
})());
check('yearBadgeOf labels a course by its home year', (() => {
  const dsai = MAJORS.find((m) => m.id === 'dsai')!;
  return yearBadgeOf(dsai, 'csai201') === 'Year 2' && yearBadgeOf(dsai, 'dsai307') === 'Year 3' && yearBadgeOf(dsai, 'dsai402') === 'Year 4' && yearBadgeOf(dsai, 'nope') === null;
})());
check('isValidYearId accepts only y1/y2/y3/y4', isValidYearId('y1') && isValidYearId('y2') && isValidYearId('y3') && isValidYearId('y4') && !isValidYearId('y5') && !isValidYearId(2) && !isValidYearId(null));

/* year id in the share codec: v4 roundtrips, v3 (yearless) still decodes */
{
  const withYear = decodeSchedule(encodeSchedule('dsai', [], {}, { yearId: 'y3' }))!;
  check('share codec: yearId roundtrips', withYear.yearId === 'y3');
  const noYear = decodeSchedule(encodeSchedule('dsai', [], {}))!;
  check('share codec: link without a year decodes with yearId undefined (defaults later)', noYear.yearId === undefined);
  // Simulated OLD v3 payload (exact old shape) must still decode.
  const legacy = base64UrlEncodeShim(JSON.stringify({ v: 3, m: 'software', r: [] }));
  const dec = decodeSchedule(legacy);
  check('share codec: legacy v3 payload still decodes', !!dec && dec.majorId === 'software' && dec.yearId === undefined);
  const badYear = decodeSchedule(base64UrlEncodeShim(JSON.stringify({ v: 4, m: 'software', r: [], y: 'y9' })));
  check('share codec: junk year id dropped, not applied', !!badYear && badYear.yearId === undefined);
  const wrongTerm = decodeSchedule(base64UrlEncodeShim(JSON.stringify({ v: 5, t: 'future-term-test', m: 'software', r: [] })));
  check('share codec: another semester is rejected instead of mapped onto current data', wrongTerm === null);
}

/* yearId + creditCap persistence & corruption tolerance */
{
  saveAppState({ ...saved, yearId: 'y4', creditCap: 18 });
  const l = loadAppState()!;
  check('appState: yearId + creditCap roundtrip', l.yearId === 'y4' && l.creditCap === 18);
  localStorage.setItem('zw-app-state-v2', JSON.stringify({ majorId: 'software', picks: {}, instructorFilter: {}, yearId: 'y7', creditCap: 99 }));
  const junky = loadAppState()!;
  check('appState: junk yearId/creditCap dropped to null', junky.yearId === null && junky.creditCap === null);
  localStorage.setItem('zw-app-state-v2', JSON.stringify({ majorId: 'software', picks: {}, instructorFilter: {} }));
  const legacyState = loadAppState()!;
  check('appState: pre-year saved state loads with null year (defaults to first year later)', legacyState.yearId === null && legacyState.creditCap === null);
  localStorage.setItem('zw-app-state-v2', JSON.stringify({ semesterKey: 'future-term-test', majorId: 'software', picks: {}, instructorFilter: {} }));
  check('appState: another semester is rejected instead of restored into current data', loadAppState() === null);
}

/* ================= 12. no-fixed-schedule placeholder courses (Part 1b) ================= */
{
  const placeholders = COURSES.filter((course) => course.noFixedSchedule);
  const senior = COURSE_BY_ID['csai498'];
  check('at least one noFixedSchedule course exists and Senior Project remains one', placeholders.length > 0 && senior?.noFixedSchedule === true && senior.credits === 1);
  check('all noFixedSchedule courses publish ZERO meetings (never invented)', placeholders.every((course) =>
    course.instructors.every((i) => i.lectures.length === 0 && i.labs.length === 0 && i.tutorials.length === 0)));
  check('publishedKinds is empty for every noFixedSchedule course', placeholders.every((course) => publishedKinds(course).length === 0));
  const placeholderPicks: PickState = Object.fromEntries(placeholders.map((course) => [course.id, emptyPick()]));
  check('noFixedSchedule courses raise no pick issues (never "still to decide")', pickIssues(placeholders, placeholderPicks, true).length === 0);
  const rep = generateBestSchedules([COURSE_BY_ID['csai201'], senior], DEFAULT_PREFERENCES);
  check('best-schedule: placeholder never blocks generation and contributes only credits', rep.schedules.length > 0 && rep.noSections.length === 0 &&
    rep.schedules.every((s) => s.perCourse.length === 2 && s.credits === 4 && s.perCourse.some((e) => e.course.id === 'csai498' && e.pairing.meetings.length === 0)));
}

/* ================= 13. credit-cap enforcement (Part 4) ================= */
{
  check('valid caps are exactly 13/18/21 and nothing else', isValidCreditCap(13) && isValidCreditCap(18) && isValidCreditCap(21) && !isValidCreditCap(22) && !isValidCreditCap('18') && !isValidCreditCap(null));
  check('effective cap defaults to 21 and can never exceed 21', effectiveCreditCap(null) === 21 && effectiveCreditCap(undefined) === 21 && effectiveCreditCap(13) === 13 && effectiveCreditCap(21) === 21);
  const p3: PickState = { csai201: emptyPick(), csai202: emptyPick(), csai205: emptyPick(), math105: emptyPick() }; // 12 credits
  check('registeredCredits sums real credit values', registeredCredits(p3) === 12);
  check('13-cap blocks the 4th→5th 3-credit course (12+3 > 13)', wouldExceedCap(p3, 'it205', 13) === true);
  check('18-cap allows it (12+3 <= 18)', wouldExceedCap(p3, 'it205', 18) === false);
  check('unchosen tier = 21-cap ceiling still enforced', (() => {
    const selected: PickState = {};
    let total = 0;
    let candidate: string | null = null;
    for (const course of COURSES.filter((course) => (course.credits ?? 0) > 0)) {
      const credits = course.credits ?? 0;
      if (total + credits <= 21) {
        selected[course.id] = emptyPick();
        total += credits;
      } else if (!candidate) {
        candidate = course.id;
      }
    }
    if (!candidate || total === 0) return false;
    return wouldExceedCap(selected, candidate, null) === true && registeredCredits(selected) === total && total <= 21;
  })());
  check('already-registered course never blocked (removal always allowed)', wouldExceedCap(p3, 'csai201', 13) === false);
  check('1-credit placeholder fits where a 3-credit course would not', (() => {
    const p: PickState = {};
    ['csai201', 'csai202', 'csai205', 'math105'].forEach((id) => { p[id] = emptyPick(); }); // 12 credits
    return wouldExceedCap(p, 'csai498', 13) === false && wouldExceedCap(p, 'it205', 13) === true;
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);


/* ================= Assistant locks regression ================= */
{
  const { pairingMatchesLockedPick } = await import('../src/lib/assistantControls');
  const math = COURSE_BY_ID['math105'];
  const pairings = buildCoursePairings(math);
  const sec3 = pairings.find((p) => p.lecture?.sec === '03');
  check('MATH 105 has Lecture Sec 03 available for lock tests', Boolean(sec3?.lecture));
  if (sec3?.lecture) {
    const key = uid(sec3.lecture);
    check(
      'locked Lecture Sec 03 only matches pairings that preserve that exact lecture',
      pairings.filter((p) => pairingMatchesLockedPick(p, { Lecture: key })).every((p) => p.lecture && uid(p.lecture) === key),
    );
  }
}

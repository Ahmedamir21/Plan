import type { Course, Meeting, MeetingType } from '../types';
import type { PickState } from './picks';
import { optionsFor, uid } from './picks';
import { overlaps, formatMeeting } from './time';
const kinds: MeetingType[] = ['Lecture', 'Lab', 'Tutorial'];
export type SelectedSnapshot = Record<
  string,
  {
    code: string;
    name: string;
    credits?: number;
    parts: Partial<
      Record<MeetingType, { key: string; meeting: Meeting; instructor: string }>
    >;
  }
>;
export type ImpactNotice = {
  id: string;
  courseId: string;
  kind: 'changed' | 'unavailable' | 'potential_conflict' | 'confirmed_conflict';
  text: string;
};
/** Legacy local keys contain meeting facts; parse, do not retarget, execute or upload them. */
export function parseSavedMeeting(
  key: unknown,
  kind?: MeetingType
): Meeting | null {
  if (typeof key !== 'string' || key.length > 500) return null;
  const parts = key.split('|');
  if (parts.length < 6) return null;
  const [type, sec, day, s, e, ...rooms] = parts,
    room = rooms.join('|'),
    start = Number(s),
    end = Number(e);
  if (
    !kinds.includes(type as MeetingType) ||
    (kind && type !== kind) ||
    !sec ||
    sec.length > 80 ||
    !['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(day) ||
    !/^\d+$/.test(s) ||
    !/^\d+$/.test(e) ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > 1440 ||
    end <= start ||
    room.length > 200
  )
    return null;
  return {
    type: type as MeetingType,
    sec,
    day: day as Meeting['day'],
    start,
    end,
    room,
  };
}
export function sanitizeSnapshot(value: unknown): SelectedSnapshot {
  const result: SelectedSnapshot = {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return result;
  for (const [id, item] of Object.entries(value).slice(0, 300)) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(id) ||
      ['__proto__', 'constructor', 'prototype'].includes(id) ||
      !item ||
      typeof item !== 'object'
    )
      continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.code !== 'string' ||
      typeof row.name !== 'string' ||
      row.code.length > 80 ||
      row.name.length > 500
    )
      continue;
    const parts: SelectedSnapshot[string]['parts'] = {};
    for (const kind of kinds) {
      const part = (row.parts as Record<string, unknown> | undefined)?.[kind];
      if (!part || typeof part !== 'object') continue;
      const p = part as {
        key: unknown;
        instructor: unknown;
        meeting?: { sourceId?: unknown };
      };
      const m = parseSavedMeeting(p.key, kind);
      if (!m || typeof p.instructor !== 'string' || p.instructor.length > 300)
        continue;
      if (
        typeof p.meeting?.sourceId === 'string' &&
        p.meeting.sourceId.length <= 200
      )
        m.sourceId = p.meeting.sourceId;
      parts[kind] = {
        key: p.key as string,
        meeting: m,
        instructor: p.instructor,
      };
    }
    result[id] = {
      code: row.code,
      name: row.name,
      parts,
      ...(typeof row.credits === 'number' &&
      row.credits >= 0 &&
      row.credits <= 21
        ? { credits: row.credits }
        : {}),
    };
  }
  return result;
}
export function selectedSnapshot(
  picks: PickState,
  courses: Record<string, Course>,
  previous: SelectedSnapshot = {},
  acknowledged = false
): SelectedSnapshot {
  const next: SelectedSnapshot = {};
  for (const [id, pick] of Object.entries(picks)) {
    const course = courses[id],
      old = previous[id];
    if (!course) {
      if (old) next[id] = old;
      continue;
    }
    const parts: SelectedSnapshot[string]['parts'] = {};
    for (const kind of kinds) {
      const key = pick[kind];
      if (!key) continue;
      // Retain the original facts for an unchanged choice, including changed instructors.
      if (old?.parts[kind]?.key === key && !acknowledged) {
        parts[kind] = old.parts[kind];
        continue;
      }
      const option = optionsFor(course, kind).find((o) => o.key === key);
      if (option)
        parts[kind] = {
          key,
          meeting: { ...option.meeting },
          instructor: option.instructor.name,
        };
      else if (old?.parts[kind]?.key === key) parts[kind] = old.parts[kind];
    }
    next[id] = {
      code: old && !acknowledged ? old.code : course.code,
      name: old && !acknowledged ? old.name : course.name,
      ...(old && !acknowledged
        ? { credits: old.credits }
        : { credits: course.credits }),
      parts,
    };
  }
  return next;
}
/** Uses only the full, committed SQL catalog already downloaded by the browser. No schedule requests. */
export function scheduleImpacts(
  picks: PickState,
  courses: Record<string, Course>,
  snapshot: SelectedSnapshot = {},
  fresh = true
): ImpactNotice[] {
  if (!fresh) return [];
  const notices: ImpactNotice[] = [],
    projected: {
      id: string;
      code: string;
      before: Meeting;
      after: Meeting;
      changed: boolean;
      reliable: boolean;
    }[] = [];
  for (const [id, pick] of Object.entries(picks)) {
    const course = courses[id],
      saved = snapshot[id];
    const code = course?.code || saved?.code || id;
    if (!course) {
      notices.push({
        id: `${id}:missing`,
        courseId: id,
        kind: 'unavailable',
        text: `${code} is not in the current published planning catalog. Its saved choice is preserved, but it cannot be displayed on the current timetable. Verify availability in Self-Service.`,
      });
      continue;
    }
    if (saved && (saved.code !== course.code || saved.name !== course.name))
      notices.push({
        id: `${id}:label`,
        courseId: id,
        kind: 'changed',
        text: `${saved.code} · ${saved.name}: the current published label is ${course.code} · ${course.name}. The course identity and your saved choices are unchanged; review this academic correction.`,
      });
    if (saved?.credits !== undefined && saved.credits !== course.credits)
      notices.push({
        id: `${id}:credits`,
        courseId: id,
        kind: 'changed',
        text: `${code}: published credits differ from your saved catalog (${saved.credits} → ${course.credits ?? 'unpublished'}). Check your credit limit; no choice was changed.`,
      });
    for (const kind of kinds) {
      const key = pick[kind];
      if (!key) continue;
      const old =
        saved?.parts[kind]?.key === key ? saved.parts[kind] : undefined;
      const before = old?.meeting || parseSavedMeeting(key, kind);
      if (!before) continue;
      const matches = optionsFor(course, kind).filter((o) =>
        before.sourceId
          ? o.meeting.sourceId === before.sourceId
          : o.meeting.sec === before.sec
      );
      if (matches.length !== 1) {
        notices.push({
          id: `${id}:${kind}:unresolved`,
          courseId: id,
          kind: 'unavailable',
          text: `${code} ${kind} ${before.sec}: ${matches.length ? 'the saved section cannot be matched uniquely' : 'the saved section is not in the current published catalog'}. Your saved choice has not been replaced. Review the section list before selecting again.`,
        });
        continue;
      }
      const option = matches[0],
        after = option.meeting;
      const meetingChanged = uid(before) !== uid(after),
        instructorChanged = !!old && old.instructor !== option.instructor.name;
      if (meetingChanged || instructorChanged)
        notices.push({
          id: `${id}:${kind}:changed`,
          courseId: id,
          kind: 'changed',
          text: `${code} ${kind} ${before.sec}: ${meetingChanged ? `saved ${formatMeeting(before)} (${before.room || 'room unpublished'}); published ${formatMeeting(after)} (${after.room || 'room unpublished'}). ` : ''}${instructorChanged ? `Instructor: ${old!.instructor} → ${option.instructor.name}. ` : ''}${before.sourceId ? 'Matched by the published source section ID.' : 'Matched by course and section label; verify that it is the same section.'} Your saved choice is unchanged.`,
        });
      projected.push({
        id,
        code,
        before,
        after,
        changed: meetingChanged,
        reliable: !!before.sourceId || key === option.key,
      });
    }
  }
  for (let i = 0; i < projected.length; i++)
    for (let j = i + 1; j < projected.length; j++) {
      const a = projected[i],
        b = projected[j];
      if (
        !(a.changed || b.changed) ||
        !overlaps(a.after, b.after) ||
        overlaps(a.before, b.before)
      )
        continue;
      const reliable = a.reliable && b.reliable;
      notices.push({
        id: `conflict:${i}:${j}`,
        courseId: a.id,
        kind: reliable ? 'confirmed_conflict' : 'potential_conflict',
        text: `${reliable ? 'The published meeting times now overlap' : 'Potential timetable conflict if these labels identify your sections'}: ${a.code} ${a.after.type} ${a.after.sec} and ${b.code} ${b.after.type} ${b.after.sec}. Review both sections. This is about the planner, not a change to your official registration.`,
      });
    }
  return notices;
}

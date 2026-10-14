import { parseSavedMeeting } from './scheduleImpact';
import { COURSE_BY_ID } from '../data/courses';
import { emptyPick, optionsFor, type PickState } from './picks';
import { MAJOR_BY_ID } from '../data/majors';
import type { Course, MeetingType } from '../types';
import {
  fromCompactPreferences,
  toCompactPreferences,
  type CompactPreferences,
  type SchedulePreferences,
} from './preferences';
import { isValidCourseFilter, isValidTypeFilter, isValidYearId, VALID_DAYS_SAFE } from './stateValidation';
import { LEGACY_UNTAGGED_SEMESTER_KEY, SEMESTER_CONFIG } from '../config/semester';

/** Query param used to carry an encoded schedule — kept short and URL-safe. */
export const SCHEDULE_PARAM = 'schedule';

const KIND_ORDER: MeetingType[] = ['Lecture', 'Lab', 'Tutorial'];

function base64UrlEncode(input: string): string {
  const base64 = window.btoa(Array.from(new TextEncoder().encode(input),byte=>String.fromCharCode(byte)).join(''));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(window.atob(padded + pad),char=>char.charCodeAt(0)));
}

export interface ShareExtras {
  /** Selected year of the major ('y2' | 'y3' | 'y4'); links without it default to the first year. */
  yearId?: string;
  requireComplete?: boolean;
  typeFilter?: string;
  courseFilter?: string;
  preferences?: SchedulePreferences;
  /**
   * Explicit instructor filter per course (courseId -> instructor index). Persisted
   * separately from the section picks so the instructor grouping survives even when a
   * shared link's section index has gone stale or was never chosen.
   */
  instructorFilter?: Record<string, number | null>;
}

/**
 * Encode everything needed to reproduce the schedule state: the major, each taken course's
 * exact meeting key, the per-course instructor filter, the active filters, and the compact
 * preferences. No names, emails or anything sensitive — opaque course IDs and the selected public meeting facts.
 */
export function encodeSchedule(
  majorId: string,
  courses: Course[],
  picks: PickState,
  extras?: ShareExtras,
): string {
  const rows: [string, string|null, string|null, string|null][] = [];
  for(const [id,pick] of Object.entries(picks)) {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(id))continue;
    rows.push([id,...KIND_ORDER.map(kind=>parseSavedMeeting(pick[kind],kind)?pick[kind]:null)] as [string,string|null,string|null,string|null]);
  }

  // Instructor filter, emitted only for courses that differ from what the picks already imply.
  const inf: [string, number][] = [];
  if (extras?.instructorFilter) {
    courses.forEach((course) => {
      const idx = extras.instructorFilter?.[course.id];
      if (typeof idx === 'number' && idx >= 0 && idx < course.instructors.length) {
        inf.push([course.id, idx]);
      }
    });
  }

  // v6 preserves exact meeting facts instead of positional indices that can shift after SQL updates.
  // v3–v5 are still readable, with an explicit caution because their original sections cannot be proved.
  const payload: Record<string, unknown> = { v: 6, t: SEMESTER_CONFIG.key, m: majorId, r: rows };
  if (extras?.yearId && isValidYearId(extras.yearId)) payload.y = extras.yearId;
  if (inf.length) payload.inf = inf;
  if (extras?.requireComplete === false) payload.rc = 0;
  if (extras?.typeFilter && isValidTypeFilter(extras.typeFilter) && extras.typeFilter !== 'All') payload.tf = extras.typeFilter;
  if (extras?.courseFilter && extras.courseFilter !== 'all') payload.cf = extras.courseFilter;
  if (extras?.preferences) {
    const compact = toCompactPreferences(extras.preferences);
    if (compact) payload.pr = compact;
  }
  return base64UrlEncode(JSON.stringify(payload));
}

export interface DecodedSchedule {
  majorId: string;
  legacySections?: boolean;
  /** Validated year id, or undefined for pre-year (v3) links — caller defaults to the first year. */
  yearId?: string;
  picks: PickState;
  instructorFilter: Record<string, number>;
  requireComplete?: boolean;
  typeFilter?: string;
  courseFilter?: string;
  preferences?: SchedulePreferences;
}

export function decodeSchedule(param: string): DecodedSchedule | null {
  try {
    if(param.length>20000)return null;
    const parsed = JSON.parse(base64UrlDecode(param)) as {
      v?: number;
      t?: unknown;
      m?: unknown;
      y?: unknown;
      r?: unknown;
      inf?: unknown;
      rc?: number;
      tf?: unknown;
      cf?: unknown;
      pr?: CompactPreferences;
    };
    if (parsed && parsed.v !== undefined && ![3,4,5,6].includes(parsed.v)) return null;
    if (!parsed || typeof parsed.m !== 'string' || !MAJOR_BY_ID[parsed.m] || !Array.isArray(parsed.r)) return null;

    const sourceSemesterKey =
      typeof parsed.t === 'string'
        ? parsed.t
        : parsed.v === 3 || parsed.v === 4 || parsed.v == null
          ? LEGACY_UNTAGGED_SEMESTER_KEY
          : null;
    if (!sourceSemesterKey || sourceSemesterKey !== SEMESTER_CONFIG.key) return null;

    const picks: PickState = {};
    const instructorFilter: Record<string, number> = {};

    parsed.r.forEach((row) => {
      if (!Array.isArray(row) || row.length !== 4) return;
      if(parsed.v===6) {
        const [id,...keys]=row;
        if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(id)||['__proto__','constructor','prototype'].includes(id))return;
        const pick=emptyPick();KIND_ORDER.forEach((kind,i)=>{if(parseSavedMeeting(keys[i],kind))pick[kind]=keys[i] as string;});
        picks[id]=pick;return;
      }
      const [courseId, li, bi, ti] = row as [string, number, number, number];
      const course = COURSE_BY_ID[courseId];
      if (!course) return; // unknown/removed course id — skip, never crash

      const pick = emptyPick();
      KIND_ORDER.forEach((kind, i) => {
        const idx = [li, bi, ti][i];
        // Out-of-range or non-numeric index (stale link) is ignored for that component only.
        if (typeof idx === 'number' && idx >= 0) {
          const opt = optionsFor(course, kind)[idx];
          if (opt) pick[kind] = opt.key;
        }
      });
      picks[courseId] = pick;
    });

    if (Array.isArray(parsed.inf)) {
      parsed.inf.forEach((row) => {
        if (!Array.isArray(row) || row.length !== 2) return;
        const [courseId, idx] = row as [string, number];
        const course = COURSE_BY_ID[courseId];
        if (!course) return;
        if (typeof idx !== 'number' || !Number.isInteger(idx)) return;
        if (idx < 0 || idx >= course.instructors.length) return;
        instructorFilter[courseId] = idx;
      });
    }

    return {
      majorId: parsed.m,
      legacySections: parsed.v !== 6,
      // v3/v4 links carry no semester key but are accepted only for their known legacy term.
      yearId: isValidYearId(parsed.y) ? parsed.y : undefined,
      picks,
      instructorFilter,
      requireComplete: parsed.rc === 0 ? false : undefined,
      typeFilter: isValidTypeFilter(parsed.tf) ? parsed.tf : undefined,
      courseFilter: isValidCourseFilter(parsed.cf) ? parsed.cf : undefined,
      preferences: parsed.pr ? fromCompactPreferences(parsed.pr) : undefined,
    };
  } catch {
    // Corrupted payload — caller falls back to safe defaults.
    return null;
  }
}

/**
 * The absolute base URL of the app as it is running RIGHT NOW: its current origin plus the
 * path the document is served from. Never a hard-coded domain — this resolves to
 * the current production host, an Arena preview host in the
 * sandbox, http://localhost:5173 in development, and any future deployment origin untouched.
 * Query strings and hashes are excluded on purpose, so sandbox/proxy parameters (and any
 * stale ?schedule= the author themselves arrived with) can never leak into the link.
 */
export function appBaseUrl(): string {
  if (typeof window === 'undefined') return '/';
  const href = window.location.href;
  try {
    const url = new URL(href);
    // Opaque origins (e.g. file://) report the literal string "null" — keep the pathname then.
    if (url.origin && url.origin !== 'null') return `${url.origin}${url.pathname}`;
    return url.pathname || '/';
  } catch {
    // Extremely defensive fallback: strip query/hash from the raw href.
    return href.split('#')[0].split('?')[0];
  }
}

/** Builds a shareable URL for the current app deployment containing only the schedule query param. */
export function buildShareUrl(majorId: string, courses: Course[], picks: PickState, extras?: ShareExtras): string {
  const encoded = encodeSchedule(majorId, courses, picks, extras);
  return `${appBaseUrl()}?${SCHEDULE_PARAM}=${encoded}`;
}

/** Reads and decodes the schedule from the current page URL, if any. Returns null when absent/invalid. */
export function readScheduleFromLocation(): DecodedSchedule | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get(SCHEDULE_PARAM);
  if (!raw) return null;
  const decoded = decodeSchedule(raw);
  // Reject payloads that decode but name an unknown major — treat as no shared state at all.
  if (decoded && !MAJOR_BY_ID[decoded.majorId]) return null;
  if (decoded?.legacySections) {
    // Drop any day codes we don't recognise so a future format change can't break rendering.
    (Object.keys(decoded.picks) as string[]).forEach((id) => {
      if (!COURSE_BY_ID[id]) delete decoded.picks[id];
    });
    decoded.picks = Object.fromEntries(
      Object.entries(decoded.picks).filter(([id]) => !!COURSE_BY_ID[id]),
    );
  }
  return decoded;
}

export { VALID_DAYS_SAFE };

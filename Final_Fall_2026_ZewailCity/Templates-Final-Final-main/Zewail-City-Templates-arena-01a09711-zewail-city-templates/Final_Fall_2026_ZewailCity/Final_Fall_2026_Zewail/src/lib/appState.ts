import { COURSE_BY_ID } from '../data/courses';
import { MAJOR_BY_ID } from '../data/majors';
import { emptyPick, type PickState } from './picks';
import type { MeetingType } from '../types';
import { sanitizePreferences, type SchedulePreferences } from './preferences';
import { isValidCourseFilter, isValidTypeFilter, isValidYearId } from './stateValidation';
import { catalogRevision } from './catalogClient';
import { parseSavedMeeting, sanitizeSnapshot, selectedSnapshot, type SelectedSnapshot } from './scheduleImpact';
import { LEGACY_UNTAGGED_SEMESTER_KEY, SEMESTER_CONFIG } from '../config/semester';

/**
 * Unified Local Storage store for everything that defines the user's current plan:
 * the major, per-course section picks, the explicit instructor filter, the browse
 * filters, and the schedule preferences. Written on every state change, restored on
 * load — but a valid shared URL always takes priority over this store (see App.tsx).
 *
 * Nothing about the user's *identity* is ever stored; only opaque ids and small ints.
 */
export const STORAGE_KEY = 'zw-app-state-v2';
let protectedRaw: string | null = null;
let persistencePaused = false;
export const preservedSchedule = () => protectedRaw;
export const isPersistencePaused = () => persistencePaused;

const KIND_ORDER: MeetingType[] = ['Lecture', 'Lab', 'Tutorial'];

/** The only credit caps the app recognises — anything else stored is dropped. */
export const VALID_CREDIT_CAPS = [13, 18, 21] as const;
export type CreditCap = (typeof VALID_CREDIT_CAPS)[number];

/** True only when `value` is one of the known cap settings. */
export function isValidCreditCap(value: unknown): value is CreditCap {
  return typeof value === 'number' && (VALID_CREDIT_CAPS as readonly number[]).includes(value);
}

/** The credit cap in force right now: the chosen tier, or the 21-credit site ceiling. */
export function effectiveCreditCap(cap: CreditCap | null | undefined): number {
  return Math.min(cap ?? 21, 21);
}

/** Total credits of every currently registered (ticked) course; unset credits count as 0. */
export function registeredCredits(picks: PickState): number {
  return Object.keys(picks).reduce((sum, id) => sum + (COURSE_BY_ID[id]?.credits ?? 0), 0);
}

/**
 * True when newly ticking `courseId` would push the registered total past the active cap.
 * Only ADDITIONS are ever blocked — an already-registered course returns false so removals
 * and re-renders can never be trapped by the cap.
 */
export function wouldExceedCap(picks: PickState, courseId: string, cap: CreditCap | null | undefined): boolean {
  if (picks[courseId]) return false;
  const adding = COURSE_BY_ID[courseId]?.credits ?? 0;
  return registeredCredits(picks) + adding > effectiveCreditCap(cap);
}

export interface PersistedState {
  semesterKey: string;
  majorId: string | null;
  /**
   * Selected year within the major ('y2' | 'y3' | 'y4'). Old saved state (pre-year schema)
   * has no value here — it loads as null and the app defaults to the major's first year.
   */
  yearId: string | null;
  /**
   * Active credit-cap SETTING (13/18/21): 13 for GPA below 2.00, 18 for GPA 2.00+,
   * and 21 only when the student explicitly selects Over Load. If no choice is made,
   * the planner keeps its general 21-credit ceiling.
   */
  creditCap: CreditCap | null;
  /** courseId -> instructor index of the active per-course FILTER pill (view state; picks are independent). */
  instructorFilter: Record<string, number>;
  picks: PickState;
  requireComplete: boolean;
  typeFilter: string;
  courseFilter: string;
  preferences: SchedulePreferences;
  savedAt: number;
  catalogRevision?: number;
  selectedSnapshot?: SelectedSnapshot;
}

/**
 * Validate a decoded blob strictly. Anything malformed, out of range, or referring to a
 * malformed value is dropped rather than applied; well-formed historical course/section keys are retained, so a corrupted or
 * outdated entry can never produce a broken UI.
 */
function validate(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const sourceSemesterKey =
    typeof r.semesterKey === 'string'
      ? r.semesterKey
      : LEGACY_UNTAGGED_SEMESTER_KEY;
  if (sourceSemesterKey !== SEMESTER_CONFIG.key) return null;

  const majorId = typeof r.majorId === 'string' && MAJOR_BY_ID[r.majorId] ? r.majorId : null;
  // Absent (old schema) or malformed year/cap fields fall back to safe defaults, never crash.
  const yearId = isValidYearId(r.yearId) ? r.yearId : null;
  const creditCap = isValidCreditCap(r.creditCap) ? r.creditCap : null;

  const picks: PickState = {};
  if (r.picks && typeof r.picks === 'object') {
    Object.entries(r.picks as Record<string, unknown>).forEach(([courseId, value]) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(courseId) || ['__proto__','constructor','prototype'].includes(courseId) || !value || typeof value !== 'object') return;
      const v = value as Record<string, unknown>;
      const pick = emptyPick();
      KIND_ORDER.forEach((kind) => {
        const key = v[kind];
        if (typeof key !== 'string') return;
        // Preserve a well-formed historical choice; never retarget a changed time silently.
        if (parseSavedMeeting(key,kind)) pick[kind] = key;
      });
      picks[courseId] = pick;
    });
  }

  const instructorFilter: Record<string, number> = {};
  if (r.instructorFilter && typeof r.instructorFilter === 'object') {
    Object.entries(r.instructorFilter as Record<string, unknown>).forEach(([courseId, idx]) => {
      const course = COURSE_BY_ID[courseId];
      if (!course || typeof idx !== 'number' || !Number.isInteger(idx)) return;
      if (idx >= 0 && idx < course.instructors.length) instructorFilter[courseId] = idx;
    });
  }

  return {
    semesterKey: SEMESTER_CONFIG.key,
    majorId,
    yearId,
    creditCap,
    instructorFilter,
    picks,
    requireComplete: r.requireComplete !== false,
    typeFilter: isValidTypeFilter(r.typeFilter) ? r.typeFilter : 'All',
    courseFilter: isValidCourseFilter(r.courseFilter) ? r.courseFilter : 'all',
    // Structural validation happens once here — never a blind cast of stored JSON.
    preferences: sanitizePreferences(r.preferences),
    savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0,
    catalogRevision: typeof r.catalogRevision === 'number' ? r.catalogRevision : undefined,
    selectedSnapshot: sanitizeSnapshot(r.selectedSnapshot),
  };
}

function preserveRaw(raw:string) {
  protectedRaw=raw;
  let key=`planora-preserved-schedule:${SEMESTER_CONFIG.key}:before-${catalogRevision}`;
  try {
    const previous=window.localStorage.getItem(key);
    if(previous===raw)return;
    if(previous!==null)key+=`:${Date.now()}`;
    window.localStorage.setItem(key,raw);
  }catch{persistencePaused=true;}
}
export function loadAppState(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  let raw:string|null=null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      // Preserve raw state BEFORE validation/autosave, including a removed course or old term.
      if (record.catalogRevision !== catalogRevision || record.semesterKey !== SEMESTER_CONFIG.key) preserveRaw(raw);
    }else preserveRaw(raw);
    return validate(parsed);
  } catch {
    if(raw)preserveRaw(raw); // Even a corrupt record remains downloadable rather than being silently erased.
    return null;
  }
}

export function saveAppState(state: Omit<PersistedState, 'savedAt' | 'semesterKey'>): void {
  if (typeof window === 'undefined' || persistencePaused) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    let previous: Record<string, unknown> = {};
    try { previous = raw ? JSON.parse(raw) : {}; } catch { /* A corrupt blob must not disable new, valid saves. */ }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, semesterKey: SEMESTER_CONFIG.key, savedAt: Date.now(),
      catalogRevision, selectedSnapshot: selectedSnapshot(state.picks,COURSE_BY_ID,sanitizeSnapshot(previous?.selectedSnapshot)) }));
  } catch {
    /* storage full or blocked — persistence is best-effort, the app keeps working */
  }
}

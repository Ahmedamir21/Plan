import type { Course, MeetingType, Pairing } from '../types';
import type { Pick, PickState } from './picks';
import { uid } from './picks';
import { LEGACY_UNTAGGED_SEMESTER_KEY, SEMESTER_CONFIG } from '../config/semester';

export type LockedComponents = Record<string, Partial<Record<MeetingType, boolean>>>;

export interface PlannerLocks {
  courseIds: string[];
  components: LockedComponents;
}

export function isCourseLocked(locks: PlannerLocks, courseId: string): boolean {
  return locks.courseIds.includes(courseId);
}

export function isComponentLocked(
  locks: PlannerLocks,
  courseId: string,
  kind: MeetingType,
): boolean {
  return isCourseLocked(locks, courseId) || locks.components[courseId]?.[kind] === true;
}

/** The header lock also reflects individually locked, selected sections for every published component. */
export function isFullyLocked(course: Course, pick: Pick | undefined, locks: PlannerLocks): boolean {
  if (!pick) return false;
  if (isCourseLocked(locks, course.id)) return true;
  const kinds: MeetingType[] = ['Lecture', 'Lab', 'Tutorial'];
  const available = kinds.filter(kind => course.instructors.some(instructor =>
    (kind === 'Lecture' ? instructor.lectures : kind === 'Lab' ? instructor.labs : instructor.tutorials).length > 0,
  ));
  return available.length > 0 && available.every(kind => Boolean(pick[kind]) && locks.components[course.id]?.[kind] === true);
}

/**
 * Returns only the currently-picked components that automation must preserve.
 * A course lock preserves every currently chosen component and prevents add/remove.
 * A component lock preserves that one current section. Empty components are not
 * fabricated into constraints — Best Schedule may still fill them.
 */
export function lockedPickForCourse(
  picks: PickState,
  locks: PlannerLocks,
  courseId: string,
): Partial<Pick> {
  const pick = picks[courseId];
  if (!pick) return {};
  const out: Partial<Pick> = {};
  const courseLocked = isCourseLocked(locks, courseId);

  (['Lecture', 'Lab', 'Tutorial'] as MeetingType[]).forEach((kind) => {
    if (courseLocked) {
      // A course lock means exactly "leave this course as-is", including
      // components that are intentionally still empty.
      out[kind] = pick[kind] ?? null;
      return;
    }
    if (isComponentLocked(locks, courseId, kind)) out[kind] = pick[kind] ?? null;
  });
  return out;
}

export function pairingMatchesLockedPick(pairing: Pairing, locked: Partial<Pick>): boolean {
  const actual: Partial<Record<MeetingType, string | null>> = {
    Lecture: pairing.lecture ? uid(pairing.lecture) : null,
    Lab: pairing.labs[0] ? uid(pairing.labs[0]) : null,
    Tutorial: pairing.tutorials[0] ? uid(pairing.tutorials[0]) : null,
  };

  return (['Lecture', 'Lab', 'Tutorial'] as MeetingType[]).every((kind) => {
    // Presence of the property is meaningful: null means "keep this
    // component empty", while an absent property means "not locked".
    if (!Object.prototype.hasOwnProperty.call(locked, kind)) return true;
    return actual[kind] === (locked[kind] ?? null);
  });
}

export function normalizeLocks(locks: PlannerLocks, picks: PickState): PlannerLocks {
  const courseIds = locks.courseIds.filter((id) => Boolean(picks[id]));
  const components: LockedComponents = {};
  Object.entries(locks.components).forEach(([courseId, byKind]) => {
    if (!picks[courseId]) return;
    const clean: Partial<Record<MeetingType, boolean>> = {};
    (['Lecture', 'Lab', 'Tutorial'] as MeetingType[]).forEach((kind) => {
      if (byKind?.[kind]) clean[kind] = true;
    });
    if (Object.keys(clean).length) components[courseId] = clean;
  });
  return { courseIds, components };
}

// Resolve after SQL hydration; the single-file production build may eagerly evaluate modules.
const lockStorageKey = () => `zc-planner-locks-v2:${SEMESTER_CONFIG.key}`;
const LEGACY_LOCK_STORAGE_KEY = 'zc-planner-locks-v1';

export function loadPlannerLocks(): PlannerLocks {
  if (typeof window === 'undefined') return { courseIds: [], components: {} };
  try {
    const current = window.localStorage.getItem(lockStorageKey());
    const legacy =
      SEMESTER_CONFIG.key === LEGACY_UNTAGGED_SEMESTER_KEY
        ? window.localStorage.getItem(LEGACY_LOCK_STORAGE_KEY)
        : null;
    const raw = current ?? legacy;
    if (!raw) return { courseIds: [], components: {} };
    const parsed = JSON.parse(raw);
    return {
      courseIds: Array.isArray(parsed?.courseIds)
        ? parsed.courseIds.filter((x: unknown): x is string => typeof x === 'string')
        : [],
      components: parsed?.components && typeof parsed.components === 'object'
        ? parsed.components
        : {},
    };
  } catch {
    return { courseIds: [], components: {} };
  }
}

export function savePlannerLocks(locks: PlannerLocks): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(lockStorageKey(), JSON.stringify(locks));
  } catch {
    // Local persistence is best-effort; planner behavior still works in-memory.
  }
}

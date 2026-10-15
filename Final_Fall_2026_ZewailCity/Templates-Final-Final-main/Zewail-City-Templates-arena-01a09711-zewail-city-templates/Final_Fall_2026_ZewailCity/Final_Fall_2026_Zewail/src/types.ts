export type Day = 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu';

/** 'Lecture' | 'Lab' | 'Tutorial' */
export type MeetingType = 'Lecture' | 'Lab' | 'Tutorial';

/**
 * A single physical meeting.
 * Times are minutes from midnight — real intervals, not fixed blocks.
 * `end` is exclusive-ish in the sense that a 2:00–3:59 PM block is stored as 840 → 960
 * (i.e. it ends exactly when the next meeting starts), so back-to-back meetings
 * never overlap while a 3:00–4:59 PM meeting (900 → 1020) does overlap it.
 */
export interface Meeting {
  /** Optional verified source identity; never inferred from a display label. */
  sourceId?: string;
  type: MeetingType;
  sec: string;
  day: Day;
  start: number;
  end: number;
  room: string;
}

export interface Instructor {
  name: string;
  /** Preserved verbatim from the original data set (e.g. "sections 09–12 unannounced"). */
  note?: string;
  /** True when self-service lists no instructor name for these sections. */
  unassigned?: boolean;
  lectures: Meeting[];
  labs: Meeting[];
  tutorials: Meeting[];
}

export interface Course {
  sourceId?: string;
  id: string;
  code: string;
  name: string;
  /** Palette index (1..7). */
  c: number;
  /**
   * Credit hours — only where the source data states them (PHYS 104 = 3).
   * Never inferred, never confused with meeting duration.
   */
  credits?: number;
  /** Legacy grouping kept for reference (IT 205 / DSAI 203 share the elective slot). */
  group?: string;
  /**
   * No published meetings. Senior Project is arranged individually and carries its
   * confirmed credits. English shells are instead marked awaitingSource and have
   * unknown credits until a verified CSV fills all official details.
   */
  noFixedSchedule?: boolean;
  /** English level shell awaiting a verified course title, credits and published sections. */
  awaitingSource?: boolean;
  instructors: Instructor[];
}

/** One academic year's course list inside a major. */
export interface YearPlan {
  id: string; // 'y1' | 'y2' | 'y3' | 'y4'
  label: string; // "Year 1 (Freshman)" | "Year 2 (Sophomore)" | "Year 3 (Junior)" | "Year 4 (Senior)"
  courseIds: string[];
}

export interface Major {
  id: string;
  title: string;
  subtitle: string;
  blurb: string;
  years: YearPlan[];
}

/** A valid, internally conflict-free set of meetings for one course under one instructor. */
export interface Pairing {
  meetings: Meeting[];
  lecture?: Meeting;
  labs: Meeting[];
  tutorials: Meeting[];
  /** Which instructor group teaches each component (components may belong to DIFFERENT groups). */
  instructors?: Partial<Record<MeetingType, number>>;
}

export interface ComboMetrics {
  score: number;
  days: number;
  isolatedDays: number;
  gapMinutes: number;
  spanMinutes: number;
  meetingMinutes: number;
  earliest: number | null;
  latest: number | null;
  sessions: number;
}

export interface GenerationResult {
  /** Flat storage: `count * courseCount` pairing indices, in generation (most-constrained-first) order. */
  flat: number[];
  count: number;
  courseCount: number;
  truncated: boolean;
  /** True when even the budgeted recount stopped — `count` is then a floor, not the true total. */
  countCapped?: boolean;
  /** Courses that have no valid pairing at all (they make every combination impossible). */
  blocked: { courseId: string; instructor: string }[];
  /** Course ids in the order used by `flat`. */
  order: string[];
  /**
   * Pairings per course in the exact (ranked) order the indices in `flat` refer to.
   * Always resolve a stored index through this map — never through a fresh build.
   */
  pairingsByCourse: Record<string, Pairing[]>;
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COURSE_BY_ID } from './data/courses';
import {
  allAvailableCourseIds,
  allYearCourseIds,
  sharedCourseIdsForMajor,
  MAJOR_BY_ID,
  yearBadgeOf,
  yearPlanOf,
} from './data/majors';
import {
  buildCoursePairings,
  comboAt,
  findBestCombo,
  generateCombinations,
  measureSchedule,
  type GenerationResult,
} from './lib/scheduler';
import {
  draftMeetings,
  draftOverlaps,
  emptyPick,
  meetingOption,
  mergeHiddenSummaries,
  optionStates,
  optionsFor,
  pickIssues,
  summarizeHidden,
  uid,
  type Pick,
  type PickState,
} from './lib/picks';
import type { ComboMetrics, Course, MeetingType, Pairing } from './types';
import { formatRange, formatDuration, to12h } from './lib/time';
import { readScheduleFromLocation, type ShareExtras } from './lib/share';
import { downloadCalendarIcs } from './lib/calendar';
import { ReportIssueDialog } from './components/ReportIssueDialog';
import { FeedbackDialog } from './components/FeedbackDialog';
import { loadPreferences, type SchedulePreferences } from './lib/preferences';
import { effectiveCreditCap, loadAppState, saveAppState, wouldExceedCap, type CreditCap } from './lib/appState';
import { computeFreeTime, WINDOW_END, WINDOW_START } from './lib/freeTime';
import type { GeneratedSchedule } from './lib/bestSchedule';
import { ThemeToggle, useTheme } from './components/ThemeToggle';
import { MajorPicker } from './components/MajorPicker';
import { YearPicker } from './components/YearPicker';
import { CrossYearBrowser } from './components/CrossYearBrowser';
import { CreditLimitNote } from './components/CreditLimitNote';
import { CoursePicker } from './components/CoursePicker';
import { Timetable, type TimetableEvent } from './components/Timetable';
import { StatsBar } from './components/StatsBar';
import { ScheduleDetails, type DetailEntry } from './components/ScheduleDetails';
import { CombinationNav, Filters, type TypeFilter } from './components/Controls';
import { EmptyState } from './components/EmptyState';
import { CreditsDashboard } from './components/CreditsDashboard';
import { ShareSchedule } from './components/ShareSchedule';
import { AboutPage } from './components/AboutPage';
import { BestSchedule } from './components/BestSchedule';
import { CommandPalette } from './components/CommandPalette';
import { Toast, type ToastState } from './components/Toast';
import { ScheduleAssistant, type AssistantLockAction, type AssistantProposal, type AssistantProposalPreview } from './components/ScheduleAssistant';
import { ShareScheduleImage } from './components/ShareScheduleImage';
import { InstallAppButton } from './components/InstallAppButton';
import { EmailNotifications } from './components/EmailNotifications';
import { CatalogUpdates } from './components/CatalogUpdates';
import { ScheduleImpact } from './components/ScheduleImpact';
import { AppStatus } from './components/AppStatus';
import { courseDataLastVerified } from './data/meta';
import { CREATOR_CREDIT, DOCUMENT_DESCRIPTION, DOCUMENT_TITLE, LEGACY_UNTAGGED_SEMESTER_KEY, SEMESTER_CONFIG, TERM_SESSION_LABEL, TERM_SESSION_PAREN_LABEL } from './config/semester';
import {
  isComponentLocked,
  isCourseLocked,
  isFullyLocked,
  loadPlannerLocks,
  normalizeLocks,
  savePlannerLocks,
  type PlannerLocks,
} from './lib/assistantControls';

function isAboutHash(): boolean {
  return typeof window !== 'undefined' && (window.location.hash ?? '').replace('#', '') === 'about';
}

/**
 * Keep only picks for courses that actually belong to the chosen major — ANY of its years,
 * since the cross-year browser legitimately adds courses from other years of the same major.
 *
 * Common courses (e.g. SCH) are also allowed because they are available to every major/year.
 */
function trimPicksToMajor(picks: PickState, majorId: string | null): PickState {
  if (!majorId) return {};
  const mj = MAJOR_BY_ID[majorId];
  const allowed = new Set(mj ? allAvailableCourseIds(mj) : []);
  const out: PickState = {};
  Object.entries(picks).forEach(([courseId, pick]) => {
    if (allowed.has(courseId) && COURSE_BY_ID[courseId]) out[courseId] = pick;
  });
  return out;
}

function trimFilterToMajor(
  filter: Record<string, number>,
  majorId: string | null,
): Record<string, number> {
  if (!majorId) return {};
  const mj = MAJOR_BY_ID[majorId];
  const allowed = new Set(mj ? allAvailableCourseIds(mj) : []);
  const out: Record<string, number> = {};
  Object.entries(filter).forEach(([courseId, idx]) => {
    const course = COURSE_BY_ID[courseId];
    if (allowed.has(courseId) && course && idx >= 0 && idx < course.instructors.length) {
      out[courseId] = idx;
    }
  });
  return out;
}

export default function App() {
  useEffect(() => {
    document.title = DOCUMENT_TITLE;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = DOCUMENT_DESCRIPTION;
  }, []);

  const [theme, setTheme] = useTheme();

  // Both sources are read exactly once. URL state always wins over Local Storage, so opening
  // a shared link never gets clobbered by a stale saved schedule.
  const [sharedOnLoad] = useState(() => readScheduleFromLocation());
  const [savedOnLoad] = useState(() => { const local=loadAppState();return sharedOnLoad?null:local; });
  const [saveSharedPlan,setSaveSharedPlan] = useState(!sharedOnLoad);

  const urlState = sharedOnLoad;
  const savedState = savedOnLoad;

  const [majorId, setMajorId] = useState<string | null>(() => {
    if (urlState && MAJOR_BY_ID[urlState.majorId]) return urlState.majorId;
    if (savedState?.majorId && MAJOR_BY_ID[savedState.majorId]) return savedState.majorId;
    return null;
  });

  /**
   * Selected year within the major. `null` means "not chosen yet" (the Year Picker step is
   * showing). Old saved state and old (v3) share links carry no year — they gracefully
   * default to the major's first year ('y1') instead of crashing or emptying the list.
   */
  const [yearId, setYearId] = useState<string | null>(() => {
    if (urlState && MAJOR_BY_ID[urlState.majorId]) return MAJOR_BY_ID[urlState.majorId].years.some(y => y.id === urlState.yearId) ? urlState.yearId! : MAJOR_BY_ID[urlState.majorId].years[0].id;
    if (savedState?.majorId && MAJOR_BY_ID[savedState.majorId]) return MAJOR_BY_ID[savedState.majorId].years.some(y => y.id === savedState.yearId) ? savedState.yearId! : MAJOR_BY_ID[savedState.majorId].years[0].id;
    return null;
  });

  /**
   * Credit-cap SETTING: 13 for GPA below 2.00, 18 for GPA 2.00+, or 21 only when
   * Over Load is selected. With no explicit choice, the planner keeps its 21-credit ceiling.
   * Nothing else is stored — no GPA value, no academic-standing label of any kind.
   */
  const [creditCap, setCreditCap] = useState<CreditCap | null>(() => savedState?.creditCap ?? null);
  const [capNoteDismissed, setCapNoteDismissed] = useState(true);

  /** Inline rejection message + per-card shake state when an addition would exceed the cap. */
  const [capNotice, setCapNotice] = useState<string | null>(null);
  const [capShake, setCapShake] = useState<{ courseId: string; nonce: number } | null>(null);
  const capNoticeTimer = useRef<number | null>(null);

  const [crossYearOpen, setCrossYearOpen] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);

  const [picks, setPicks] = useState<PickState>(() => {
    if (urlState && MAJOR_BY_ID[urlState.majorId]) {
      return urlState.legacySections ? trimPicksToMajor(urlState.picks, urlState.majorId) : urlState.picks;
    }

    if (savedState?.picks) {
      return savedState.picks; // Keep historical/retired choices; warnings explain unresolved sections.
    }

    return {};
  });

  const [showMajorPicker, setShowMajorPicker] = useState(false);

  const [requireComplete, setRequireComplete] = useState(
    () => urlState?.requireComplete ?? savedState?.requireComplete ?? true,
  );

  const [typeFilter, setTypeFilter] = useState<TypeFilter>(
    () => (urlState?.typeFilter as TypeFilter) || (savedState?.typeFilter as TypeFilter) || 'All',
  );

  const [courseFilter, setCourseFilter] = useState<string>(
    () => urlState?.courseFilter ?? savedState?.courseFilter ?? 'all',
  );

  /**
   * Active "instructor filter" per course — a pure VIEW filter driven only by the
   * per-course pills. Picks never fix an instructor: lecture, lab and tutorial are each
   * chosen independently and may belong to different instructors. The filter is stored and
   * shared so a restored link reproduces exactly what the author was looking at.
   */
  const [instructorFilter, setInstructorFilter] = useState<Record<string, number>>(() => {
    if (urlState && MAJOR_BY_ID[urlState.majorId]) {
      return trimFilterToMajor(urlState.instructorFilter, urlState.majorId);
    }

    if (savedState?.instructorFilter) {
      return trimFilterToMajor(savedState.instructorFilter, savedState.majorId);
    }

    return {};
  });

  const [preferences, setPreferences] = useState<SchedulePreferences>(
    // URL preferences > saved app-state preferences > legacy prefs key > defaults (validated in each loader).
    () => urlState?.preferences ?? savedState?.preferences ?? loadPreferences(),
  );

  const [comboIndex, setComboIndex] = useState(0);
  const [best, setBest] = useState<{
    key: string;
    index: number;
    metrics: ComboMetrics;
    complete: boolean;
  } | null>(null);

  const [copied, setCopied] = useState(false);
  const [showAbout, setShowAbout] = useState(isAboutHash);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [mobileScheduleOpen, setMobileScheduleOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [reportTarget, setReportTarget] = useState<{ courseId?: string } | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [hoveredCourseId, setHoveredCourseId] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  /** Lifted so the Credits Dashboard and the mobile action bar can open the preferences modal. */
  const [prefsOpen, setPrefsOpen] = useState(false);

  const [plannerLocks, setPlannerLocks] = useState<PlannerLocks>(() => loadPlannerLocks());
  const [assistantConstraints, setAssistantConstraints] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const storageKey = `zc-assistant-constraints-v2:${SEMESTER_CONFIG.key}`;
      const legacy =
        SEMESTER_CONFIG.key === LEGACY_UNTAGGED_SEMESTER_KEY
          ? window.localStorage.getItem('zc-assistant-constraints-v1')
          : null;
      const raw = window.localStorage.getItem(storageKey) ?? legacy;
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
    } catch {
      return [];
    }
  });

  /** Always-fresh mirrors so the stable toggleCourse callback can enforce the credit cap. */
  const picksRef = useRef(picks);
  picksRef.current = picks;

  const creditCapRef = useRef(creditCap);
  creditCapRef.current = creditCap;

  useEffect(() => {
    const normalized = normalizeLocks(plannerLocks, picks);
    if (JSON.stringify(normalized) !== JSON.stringify(plannerLocks)) {
      setPlannerLocks(normalized);
      return;
    }
    if(saveSharedPlan) savePlannerLocks(normalized);
  }, [plannerLocks, picks, saveSharedPlan]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`zc-assistant-constraints-v2:${SEMESTER_CONFIG.key}`, JSON.stringify(assistantConstraints.slice(0, 8)));
    } catch {
      // Persistence is best-effort.
    }
  }, [assistantConstraints]);

  useEffect(() => {
    const onHashChange = () => setShowAbout(isAboutHash());

    window.addEventListener('hashchange', onHashChange);

    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const showToast = useCallback((next: ToastState) => {
    setToast(next);
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  const reportCourseIssue = useCallback((courseId: string) => {
    if (COURSE_BY_ID[courseId]) setReportTarget({ courseId });
  }, []);

  const reportGeneralIssue = useCallback(() => setReportTarget({}), []);

  useEffect(() => {
    const onCommandKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
        return;
      }
      if (!editing && e.key === '/' && !commandOpen) {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', onCommandKey);
    return () => window.removeEventListener('keydown', onCommandKey);
  }, [commandOpen]);

  const openAbout = useCallback(() => {
    window.location.hash = 'about';
    setShowAbout(true);
  }, []);

  const closeAbout = useCallback(() => {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setShowAbout(false);
  }, []);

  const major = majorId ? MAJOR_BY_ID[majorId] : null;
  const yearPlan = major && yearId ? yearPlanOf(major, yearId) : null;

  /**
   * Courses shown in the picker:
   * - the selected year's courses
   * - all common courses (e.g. SCH), available to every major/year
   * - courses from other years of the same major only when selected through the cross-year browser
   */
  const courses: Course[] = useMemo(() => {
    if (!major || !yearPlan) return [];

    // Current year's courses + common courses (e.g. SCH) available to every year.
    const baseIds = [...new Set([...yearPlan.courseIds, ...sharedCourseIdsForMajor(major)])];

    const base = baseIds
      .map((id) => COURSE_BY_ID[id])
      .filter((c): c is Course => !!c);

    const inBase = new Set(baseIds);

    // Extra courses from other years are shown only when selected through
    // the cross-year browser.
    const extras = allYearCourseIds(major)
      .filter((id) => !inBase.has(id) && picks[id] && COURSE_BY_ID[id])
      .map((id) => COURSE_BY_ID[id]);

    return [...base, ...extras];
  }, [major, yearPlan, picks]);

  /** "Year X" badge for every course NOT belonging to the currently selected year. */
  const yearBadges = useMemo(() => {
    if (!major || !yearPlan) return {};

    const out: Record<string, string> = {};

    courses.forEach((c) => {
      if (yearPlan.courseIds.includes(c.id)) return;

      const badge = yearBadgeOf(major, c.id);
      if (badge) out[c.id] = badge;
    });

    return out;
  }, [major, yearPlan, courses]);

  const takenCourses = useMemo(
    () => courses.filter((c) => picks[c.id]),
    [courses, picks],
  );

  /** Effective credit cap — the chosen tier, otherwise the planner's 21-credit hard ceiling. */
  const effectiveCap = effectiveCreditCap(creditCap);

  /* ---------------- Local Storage persistence (URL state always wins on load) ---------------- */

  useEffect(() => {
    if(!saveSharedPlan)return;
    saveAppState({
      majorId,
      yearId,
      creditCap,
      instructorFilter,
      picks,
      requireComplete,
      typeFilter,
      courseFilter,
      preferences,
    });
  }, [
    saveSharedPlan,
    majorId,
    yearId,
    creditCap,
    instructorFilter,
    picks,
    requireComplete,
    typeFilter,
    courseFilter,
    preferences,
  ]);

  const draft = useMemo(
    () => draftMeetings(takenCourses, picks),
    [takenCourses, picks],
  );

  const overlapsFound = useMemo(
    () => draftOverlaps(draft),
    [draft],
  );

  const issues = useMemo(
    () => pickIssues(takenCourses, picks, requireComplete),
    [takenCourses, picks, requireComplete],
  );

  const noConflicts = overlapsFound.length === 0;

  /**
   * Engine space: every conflict-free combination across ALL instructor groups.
   * A lecture may pair with any instructor's lab/tutorial — the only pairing rule is
   * the time-overlap check (inside each course AND across the whole selection).
   */
  const generation: GenerationResult | null = useMemo(() => {
    // Courses with no published schedule (noFixedSchedule) are excluded from the search
    // space entirely: they are always trivially satisfied and contribute only credits,
    // never a scheduling constraint (and must not read as "blocked").
    const schedulable = takenCourses.filter((c) => !c.noFixedSchedule);

    if (schedulable.length === 0) return null;

    const entries = schedulable.map((course) => ({
      course,
      pairings: buildCoursePairings(course),
    }));

    return generateCombinations(entries);
  }, [takenCourses]);

  const count = generation?.count ?? 0;

  const storedCount = generation
    ? generation.truncated
      ? Math.floor(generation.flat.length / Math.max(1, generation.courseCount))
      : generation.count
    : 0;

  const safeIndex = storedCount > 0 ? Math.min(comboIndex, storedCount - 1) : 0;

  const genKey = useMemo(
    () => `${majorId ?? ''}|${takenCourses.map((c) => c.id).join(',')}|${requireComplete}`,
    [majorId, takenCourses, requireComplete],
  );

  useEffect(() => {
    setComboIndex(0);
    setBest(null);
  }, [genKey]);

  /** Apply a generated combination back onto the radio selections. */
  const applyCombo = useCallback(
    (index: number) => {
      if (!generation) return;

      const indices = comboAt(generation, index);
      if (!indices) return;

      setPicks((prev) => {
        const next: PickState = { ...prev };

        generation.order.forEach((courseId, i) => {
          const pairing: Pairing | undefined = generation.pairingsByCourse[courseId]?.[indices[i]];
          if (!pairing) return;

          next[courseId] = {
            Lecture: pairing.lecture ? uid(pairing.lecture) : null,
            Lab: pairing.labs[0] ? uid(pairing.labs[0]) : null,
            Tutorial: pairing.tutorials[0] ? uid(pairing.tutorials[0]) : null,
          };
        });

        return next;
      });

      setComboIndex(index);
    },
    [generation],
  );

  const isCurrentComboBest = !!best && best.key === genKey && best.index === safeIndex;

  const engineInSync = useMemo(() => {
    if (!generation || count === 0) return false;

    const indices = comboAt(generation, safeIndex);
    if (!indices) return false;

    return generation.order.every((courseId, i) => {
      const pairing = generation.pairingsByCourse[courseId]?.[indices[i]];
      const pick = picks[courseId];

      if (!pairing || !pick) return false;

      return (
        (pairing.lecture ? uid(pairing.lecture) : null) === pick.Lecture &&
        (pairing.labs[0] ? uid(pairing.labs[0]) : null) === pick.Lab &&
        (pairing.tutorials[0] ? uid(pairing.tutorials[0]) : null) === pick.Tutorial
      );
    });
  }, [generation, count, safeIndex, picks]);

  /* ---------------- actions ---------------- */

  const selectMajor = useCallback((id: string) => {
    setMajorId(id);
    setPicks({});
    setInstructorFilter({});
    setCourseFilter('all');
    setTypeFilter('All');
    setComboIndex(0);
    setBest(null);
    setShowMajorPicker(false);
    setShowYearPicker(false);
    setCreditCap(null);
    setCapNoteDismissed(true);
    setCapNotice(null);
    setCapShake(null);
    setCrossYearOpen(false);
    setPlannerLocks({ courseIds: [], components: {} });
    setAssistantConstraints([]);
  }, []);

  const selectYear = useCallback((id: string) => {
    if (majorId && (!MAJOR_BY_ID[majorId]?.years.some(year => year.id === id) || (majorId === 'it' && id === 'y1'))) setMajorId(null);
    setYearId((prev) => {
      if (prev === id) return prev;

      setPicks({});
      setInstructorFilter({});
      setCourseFilter('all');
      setTypeFilter('All');
      setComboIndex(0);
      setBest(null);
      setCreditCap(null);
      setCapNoteDismissed(true);
      setCapNotice(null);
      setCapShake(null);

      return id;
    });

    setShowYearPicker(false);
    setCrossYearOpen(false);
    setPlannerLocks({ courseIds: [], components: {} });
    setAssistantConstraints([]);
  }, [majorId]);

  const chooseCreditCap = useCallback((cap: CreditCap) => {
    setCreditCap(cap);
    setCapNoteDismissed(true);
    setCapNotice(null);
  }, []);

  const dismissCapNote = useCallback(() => {
    setCapNoteDismissed(true);
  }, []);

  const reopenCapNote = useCallback(() => setCapNoteDismissed(false), []);

  const toggleCourseLock = useCallback((courseId: string) => {
    setPlannerLocks((prev) => {
      const course = COURSE_BY_ID[courseId];
      if (course && !isCourseLocked(prev, courseId) && isFullyLocked(course, picksRef.current[courseId], prev)) {
        const components = { ...prev.components };
        delete components[courseId];
        return { ...prev, components };
      }
      return {
        ...prev,
        courseIds: prev.courseIds.includes(courseId)
          ? prev.courseIds.filter((id) => id !== courseId)
          : [...prev.courseIds, courseId],
      };
    });
  }, []);

  const toggleComponentLock = useCallback((courseId: string, kind: MeetingType) => {
    setPlannerLocks((prev) => {
      const byKind = { ...(prev.components[courseId] ?? {}) };
      if (byKind[kind]) delete byKind[kind];
      else byKind[kind] = true;
      const components = { ...prev.components };
      if (Object.keys(byKind).length) components[courseId] = byKind;
      else delete components[courseId];
      return { ...prev, components };
    });
  }, []);

  const removeAssistantConstraint = useCallback((constraint: string) => {
    setAssistantConstraints((prev) => prev.filter((item) => item !== constraint));
  }, []);

  const addAssistantConstraints = useCallback((constraints: string[]) => {
    setAssistantConstraints((prev) =>
      Array.from(new Set([...prev, ...constraints.map((x) => x.trim()).filter(Boolean)])).slice(0, 8),
    );
  }, []);

  const applyAssistantLockActions = useCallback((actions: AssistantLockAction[]) => {
    setPlannerLocks((prev) => {
      let next: PlannerLocks = {
        courseIds: [...prev.courseIds],
        components: Object.fromEntries(
          Object.entries(prev.components).map(([courseId, byKind]) => [courseId, { ...byKind }]),
        ),
      };

      actions.forEach((action) => {
        if (!COURSE_BY_ID[action.courseId] || !picksRef.current[action.courseId]) return;
        if (action.action === 'lock_course') {
          if (!next.courseIds.includes(action.courseId)) next.courseIds.push(action.courseId);
          return;
        }
        if (action.action === 'unlock_course') {
          next.courseIds = next.courseIds.filter((id) => id !== action.courseId);
          return;
        }
        if (!action.meetingType) return;
        const byKind = { ...(next.components[action.courseId] ?? {}) };
        if (action.action === 'lock_component') byKind[action.meetingType] = true;
        else delete byKind[action.meetingType];
        if (Object.keys(byKind).length) next.components[action.courseId] = byKind;
        else delete next.components[action.courseId];
      });

      return next;
    });
  }, []);

  const changePick = useCallback((courseId: string, pick: Pick) => {
    setPicks((prev) => ({ ...prev, [courseId]: pick }));
  }, []);

  const toggleCourse = useCallback((courseId: string, taking: boolean) => {
    const course = COURSE_BY_ID[courseId];
    if (taking) {
      if (wouldExceedCap(picksRef.current, courseId, creditCapRef.current)) {
        const cap = effectiveCreditCap(creditCapRef.current);

        setCapNotice(
          `This would put you over your ${cap}-credit limit. Remove a course first.`,
        );

        setCapShake((prev) => ({
          courseId,
          nonce: (prev?.nonce ?? 0) + 1,
        }));

        if (capNoticeTimer.current != null) {
          window.clearTimeout(capNoticeTimer.current);
        }

        capNoticeTimer.current = window.setTimeout(
          () => setCapNotice(null),
          4000,
        );

        return;
      }
    }

    const previousPick = picksRef.current[courseId];
    const previousInstructorFilter = instructorFilter[courseId];

    setPicks((prev) => {
      const next = { ...prev };

      if (taking) next[courseId] = prev[courseId] ?? emptyPick();
      else delete next[courseId];

      return next;
    });

    if (course) {
      if (taking) {
        showToast({ message: `${course.code} added to your schedule.` });
      } else {
        showToast({
          message: `${course.code} removed.`,
          actionLabel: 'Undo',
          onAction: () => {
            setPicks((prev) => ({ ...prev, [courseId]: previousPick ?? emptyPick() }));
            if (previousInstructorFilter != null) {
              setInstructorFilter((prev) => ({ ...prev, [courseId]: previousInstructorFilter }));
            }
            setToast(null);
          },
        });
      }
    }

    if (!taking) {
      setPlannerLocks((prev) => {
        const components = { ...prev.components };
        delete components[courseId];
        return {
          courseIds: prev.courseIds.filter((id) => id !== courseId),
          components,
        };
      });
      setInstructorFilter((prev) => {
        if (prev[courseId] == null) return prev;

        const next = { ...prev };
        delete next[courseId];

        return next;
      });
    }
  }, [showToast, instructorFilter]);

  const clearOne = useCallback((courseId: string) => {
    setPicks((prev) => ({ ...prev, [courseId]: emptyPick() }));
    setPlannerLocks((prev) => {
      const components = { ...prev.components };
      delete components[courseId];
      return { ...prev, components };
    });
    setInstructorFilter((prev) => {
      if (prev[courseId] == null) return prev;

      const next = { ...prev };
      delete next[courseId];

      return next;
    });
  }, []);

  const setInstructorPinned = useCallback((courseId: string, idx: number | null) => {
    setInstructorFilter((prev) => {
      const next = { ...prev };

      if (idx == null) delete next[courseId];
      else next[courseId] = idx;

      return next;
    });
  }, []);

  const performClearAll = useCallback(() => {
    const previousPicks = picksRef.current;
    const previousInstructorFilter = instructorFilter;
    const previousTypeFilter = typeFilter;
    const previousCourseFilter = courseFilter;
    const previousLocks = plannerLocks;
    setPicks({});
    setPlannerLocks({ courseIds: [], components: {} });
    setInstructorFilter({});
    setComboIndex(0);
    setBest(null);
    setTypeFilter('All');
    setCourseFilter('all');
    setConfirmClearOpen(false);
    showToast({
      message: 'Schedule cleared.',
      actionLabel: 'Undo',
      onAction: () => {
        setPicks(previousPicks);
        setInstructorFilter(previousInstructorFilter);
        setTypeFilter(previousTypeFilter);
        setCourseFilter(previousCourseFilter);
        setPlannerLocks(previousLocks);
        setToast(null);
      },
    });
  }, [showToast, instructorFilter, typeFilter, courseFilter, plannerLocks]);

  const requestClearAll = useCallback(() => setConfirmClearOpen(true), []);

  const useGeneratedSchedule = useCallback((schedule: GeneratedSchedule) => {
    setPicks((prev) => {
      const next: PickState = { ...prev };

      schedule.perCourse.forEach(({ course, pairing }) => {
        const current = prev[course.id] ?? emptyPick();
        const proposed: Pick = {
          Lecture: pairing.lecture ? uid(pairing.lecture) : null,
          Lab: pairing.labs[0] ? uid(pairing.labs[0]) : null,
          Tutorial: pairing.tutorials[0] ? uid(pairing.tutorials[0]) : null,
        };
        if (isCourseLocked(plannerLocks, course.id)) {
          next[course.id] = current;
          return;
        }
        (['Lecture', 'Lab', 'Tutorial'] as MeetingType[]).forEach((kind) => {
          if (isComponentLocked(plannerLocks, course.id, kind)) proposed[kind] = current[kind];
        });
        next[course.id] = proposed;
      });

      return next;
    });

    setInstructorFilter((prev) => {
      const next = { ...prev };

      schedule.perCourse.forEach(({ course, instructorIdx }) => {
        next[course.id] = instructorIdx;
      });

      return next;
    });

    setComboIndex(0);
    setBest(null);
  }, [plannerLocks]);

  const autoFill = useCallback(() => {
    if (!generation) return;

    const result = findBestCombo(generation);
    if (!result) return;

    applyCombo(result.index);

    setBest({
      key: genKey,
      index: result.index,
      metrics: result.metrics,
      complete: result.complete,
    });
  }, [generation, applyCombo, genKey]);

  const suggestBest = autoFill;

  const goPrev = useCallback(() => {
    if (storedCount === 0) return;

    applyCombo((safeIndex - 1 + storedCount) % storedCount);
  }, [storedCount, safeIndex, applyCombo]);

  const goNext = useCallback(() => {
    if (storedCount === 0) return;

    applyCombo((safeIndex + 1) % storedCount);
  }, [storedCount, safeIndex, applyCombo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;

      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [goPrev, goNext]);

  /* ---------------- derived view data ---------------- */

  const detailEntries: DetailEntry[] = useMemo(
    () =>
      draft
        .map((d) => ({
          course: d.course,
          instructor: d.option.instructor,
          pairing: {
            meetings: [d.meeting],
            lecture: d.meeting.type === 'Lecture' ? d.meeting : undefined,
            labs: d.meeting.type === 'Lab' ? [d.meeting] : [],
            tutorials: d.meeting.type === 'Tutorial' ? [d.meeting] : [],
            instructors: { [d.meeting.type]: d.option.instructorIdx },
          },
        }))
        .reduce<DetailEntry[]>((acc, entry) => {
          const existing = acc.find((e) => e.course.id === entry.course.id);

          if (existing) {
            existing.pairing.meetings.push(...entry.pairing.meetings);

            if (entry.pairing.lecture) {
              existing.pairing.lecture = entry.pairing.lecture;
            }

            existing.pairing.labs.push(...entry.pairing.labs);
            existing.pairing.tutorials.push(...entry.pairing.tutorials);

            existing.pairing.instructors = {
              ...existing.pairing.instructors,
              ...entry.pairing.instructors,
            };
          } else {
            acc.push({
              course: entry.course,
              instructor: entry.instructor,
              pairing: {
                meetings: [...entry.pairing.meetings],
                lecture: entry.pairing.lecture,
                labs: entry.pairing.meetings.filter((m) => m.type === 'Lab'),
                tutorials: entry.pairing.meetings.filter((m) => m.type === 'Tutorial'),
                instructors: entry.pairing.instructors,
              },
            });
          }

          return acc;
        }, [])
        .concat(
          takenCourses
            .filter((c) => c.noFixedSchedule)
            .map((course) => ({
              course,
              instructor: course.instructors[0] ?? { name: 'Not published', unassigned: true, lectures: [], labs: [], tutorials: [] },
              pairing: { meetings: [], labs: [], tutorials: [] },
            })),
        ),
    [draft, takenCourses],
  );

  const metrics = useMemo(
    () => measureSchedule(draft.map((d) => d.meeting)),
    [draft],
  );

  const totalCredits = useMemo(
    () => takenCourses.reduce((sum, c) => sum + (c.credits ?? 0), 0),
    [takenCourses],
  );

  const previousCreditTotal = useRef<number | null>(null);

  useEffect(() => {
    if (previousCreditTotal.current === totalCredits) return;
    previousCreditTotal.current = totalCredits;

    const notices: Record<number, ToastState> = {
      13: {
        message: 'You’re at 13 credits. If your GPA is 2.00 or higher, you can register up to 18 credits.',
        tone: 'info',
      },
      17: {
        message: 'You’re at 17 credits — 1 credit away from the standard 18-credit limit.',
        tone: 'info',
      },
      18: {
        message: 'You’ve reached 18 credits. This is the standard maximum for GPA 2.00 or higher.',
        tone: 'warning',
      },
      21: {
        message: 'You’ve reached 21 credits — this is the maximum credit limit.',
        tone: 'danger',
      },
    };

    const notice = notices[totalCredits];
    if (notice) showToast(notice);
  }, [totalCredits, showToast]);

  const freeTime = useMemo(
    () => computeFreeTime(draft.map((d) => d.meeting)),
    [draft],
  );

  const hiddenSummary = useMemo(
    () =>
      mergeHiddenSummaries(
        takenCourses.flatMap((course) =>
          (['Lecture', 'Lab', 'Tutorial'] as MeetingType[]).map((kind) =>
            summarizeHidden(
              optionStates(course, kind, takenCourses, picks, {
                pinnedInstructorIdx: instructorFilter[course.id] ?? null,
                preferences,
              }),
            ),
          ),
        ),
      ),
    [takenCourses, picks, instructorFilter, preferences],
  );

  const allEvents: TimetableEvent[] = useMemo(
    () => draft.map((d) => ({ meeting: d.meeting, course: d.course })),
    [draft],
  );

  const visibleEvents = useMemo(
    () =>
      allEvents.filter(
        (e) =>
          (typeFilter === 'All' || (e.meeting.type as MeetingType) === typeFilter) &&
          (courseFilter === 'all' || e.course.id === courseFilter),
      ),
    [allEvents, typeFilter, courseFilter],
  );

  const bestLabel = isCurrentComboBest
    ? `${best!.metrics.days} campus day${best!.metrics.days === 1 ? '' : 's'} · ${formatDuration(
        best!.metrics.gapMinutes,
      )} idle · ends ${
        best!.metrics.latest != null ? to12h(best!.metrics.latest) : '—'
      }`
    : null;

  const canExport = draft.length > 0 && noConflicts;
  const ready = takenCourses.length > 0 && noConflicts && issues.length === 0;

  const shareExtras: ShareExtras = useMemo(
    () => ({
      yearId: yearId ?? undefined,
      requireComplete,
      typeFilter,
      courseFilter,
      preferences,
      instructorFilter,
    }),
    [yearId, requireComplete, typeFilter, courseFilter, preferences, instructorFilter],
  );

  const evaluateAssistantProposal = useCallback(
    (proposal: AssistantProposal):
      | { ok: true; next: PickState; nextMetrics: ComboMetrics; nextCredits: number }
      | { ok: false; message: string; conflict?: { title: string; details: string[] } } => {
      if (!major || !proposal.changes.length) {
        return { ok: false, message: 'There are no valid changes to apply.' };
      }

      const allowedCourseIds = new Set(allAvailableCourseIds(major));

      if (proposal.changes.length > 8) {
        return { ok: false, message: 'That proposal contains too many changes to validate safely at once.' };
      }

      const seenComponent = new Set<string>();
      const perCourseTypes = new Map<string, Set<string>>();
      for (const change of proposal.changes) {
        const kinds = perCourseTypes.get(change.courseId) ?? new Set<string>();
        kinds.add(change.type);
        perCourseTypes.set(change.courseId, kinds);

        if (change.type === 'set_meeting') {
          const key = `${change.courseId}:${change.meetingType}`;
          if (seenComponent.has(key)) {
            return { ok: false, message: 'That proposal tries to set the same course component more than once. Ask for another option.' };
          }
          seenComponent.add(key);
        }
      }
      for (const [, kinds] of perCourseTypes) {
        if (kinds.has('remove_course') && kinds.size > 1) {
          return { ok: false, message: 'That proposal both removes and changes the same course. Ask for another option.' };
        }
      }

      const next: PickState = Object.fromEntries(
        Object.entries(picksRef.current).map(([courseId, pick]) => [courseId, { ...pick }]),
      );

      for (const change of proposal.changes) {
        const course = COURSE_BY_ID[change.courseId];

        if (!course || !allowedCourseIds.has(change.courseId)) {
          return { ok: false, message: 'That proposal contains a course that is not available for your current major.' };
        }

        if (change.type === 'remove_course') {
          if (isCourseLocked(plannerLocks, change.courseId)) {
            return { ok: false, message: `${course.code} is locked. Unlock it before AI can remove it.` };
          }
          delete next[change.courseId];
          continue;
        }

        if (!next[change.courseId]) {
          if (wouldExceedCap(next, change.courseId, creditCapRef.current)) {
            return { ok: false, message: 'That change would exceed your selected credit limit.' };
          }
          next[change.courseId] = emptyPick();
        }

        if (change.type === 'add_course') continue;

        if (isComponentLocked(plannerLocks, change.courseId, change.meetingType)) {
          return {
            ok: false,
            message: `${course.code} ${change.meetingType} is locked. Unlock it before AI can change that section.`,
          };
        }

        const option = optionsFor(course, change.meetingType).find((item) => item.key === change.meetingId);
        if (!option) {
          return {
            ok: false,
            message: `That ${change.meetingType.toLowerCase()} section is no longer available in the planner data.`,
          };
        }

        next[change.courseId] = {
          ...next[change.courseId],
          [change.meetingType]: option.key,
        };
      }

      const nextCourses = Object.keys(next)
        .map((courseId) => COURSE_BY_ID[courseId])
        .filter((course): course is Course => Boolean(course));
      const nextDraft = draftMeetings(nextCourses, next);
      const nextOverlaps = draftOverlaps(nextDraft);

      if (nextOverlaps.length > 0) {
        const first = nextOverlaps[0];
        const start = Math.max(first.a.meeting.start, first.b.meeting.start);
        const end = Math.min(first.a.meeting.end, first.b.meeting.end);
        return {
          ok: false,
          message: `This proposal would create a conflict between ${first.a.course.code} ${first.a.meeting.type} Sec ${first.a.meeting.sec} and ${first.b.course.code} ${first.b.meeting.type} Sec ${first.b.meeting.sec}.`,
          conflict: {
            title: `${first.a.meeting.day} conflict · ${formatRange(start, end)} overlap`,
            details: [
              `${first.a.course.code} · ${first.a.meeting.type} Sec ${first.a.meeting.sec} · ${formatRange(first.a.meeting.start, first.a.meeting.end)} · ${first.a.meeting.room || 'Room not published'}`,
              `${first.b.course.code} · ${first.b.meeting.type} Sec ${first.b.meeting.sec} · ${formatRange(first.b.meeting.start, first.b.meeting.end)} · ${first.b.meeting.room || 'Room not published'}`,
            ],
          },
        };
      }

      return {
        ok: true,
        next,
        nextMetrics: measureSchedule(nextDraft.map((item) => item.meeting)),
        nextCredits: nextCourses.reduce((sum, course) => sum + (course.credits ?? 0), 0),
      };
    },
    [major, plannerLocks],
  );

  const previewAssistantProposal = useCallback(
    (proposal: AssistantProposal): AssistantProposalPreview => {
      const current = picksRef.current;
      const describeMeeting = (course: Course, kind: MeetingType, key: string | null | undefined) => {
        if (!key) return 'Not selected';
        const option = optionsFor(course, kind).find((item) => item.key === key);
        if (!option) return 'Section no longer available';
        const m = option.meeting;
        return `Sec ${m.sec} · ${m.day} ${formatRange(m.start, m.end)} · ${m.room || 'Room not published'} · ${option.instructor.name}`;
      };

      const changes = proposal.changes.map((change) => {
        const course = COURSE_BY_ID[change.courseId];
        const code = course?.code ?? change.courseId;
        if (!course) return { title: change.label || code, reason: change.reason };

        if (change.type === 'set_meeting') {
          return {
            title: change.label || `${code} · ${change.meetingType}`,
            before: describeMeeting(course, change.meetingType, current[change.courseId]?.[change.meetingType]),
            after: describeMeeting(course, change.meetingType, change.meetingId),
            reason: change.reason,
          };
        }
        if (change.type === 'add_course') {
          return {
            title: change.label || `Add ${code}`,
            before: current[change.courseId] ? 'Already selected' : 'Not selected',
            after: `${code} added · ${course.credits ?? 0} credits`,
            reason: change.reason,
          };
        }
        return {
          title: change.label || `Remove ${code}`,
          before: current[change.courseId] ? `${code} selected` : 'Not selected',
          after: 'Removed from planner',
          reason: change.reason,
        };
      });

      const result = evaluateAssistantProposal(proposal);
      if (!result.ok) return { ...result, changes };

      return {
        ok: true,
        changes,
        stats: {
          campusDays: `${metrics.days} → ${result.nextMetrics.days}`,
          gaps: `${formatDuration(metrics.gapMinutes)} → ${formatDuration(result.nextMetrics.gapMinutes)}`,
          credits: `${totalCredits} → ${result.nextCredits}`,
          conflicts: `${draftOverlaps(draft).length} → 0`,
        },
      };
    },
    [evaluateAssistantProposal, metrics, totalCredits, draft],
  );

  const applyAssistantProposal = useCallback(
    (proposal: AssistantProposal): { ok: boolean; message: string } => {
      const result = evaluateAssistantProposal(proposal);
      if (!result.ok) return result;

      const previousPicks = picksRef.current;
      setPicks(result.next);
      setComboIndex(0);
      setBest(null);

      showToast({
        message: 'AI schedule changes applied.',
        actionLabel: 'Undo',
        onAction: () => {
          setPicks(previousPicks);
          setComboIndex(0);
          setBest(null);
          setToast(null);
        },
      });

      return {
        ok: true,
        message: `✓ Applied ${proposal.changes.length} validated change${proposal.changes.length === 1 ? '' : 's'}. You can undo them from the notification.`,
      };
    },
    [evaluateAssistantProposal, showToast],
  );

  const assistantContext = useMemo<Record<string, unknown>>(
    () => ({
      term: TERM_SESSION_LABEL,
      dataLastVerified: courseDataLastVerified(),
      major: major ? { id: major.id, title: major.title, subtitle: major.subtitle } : null,
      year: yearPlan ? { id: yearPlan.id, label: yearPlan.label } : null,
      creditLimit: effectiveCap,
      selectedCreditCap: creditCap,
      generalMaximumCredits: 21,
      overLoadSelected: creditCap === 21,
      totalSelectedCredits: totalCredits,
      selectedCourseIds: Object.keys(picks),
      scheduleStats: {
        sessions: metrics.sessions,
        campusDays: metrics.days,
        gapMinutes: metrics.gapMinutes,
        earliest: metrics.earliest != null ? to12h(metrics.earliest) : null,
        latest: metrics.latest != null ? to12h(metrics.latest) : null,
      },
      preferences,
      persistentConstraints: assistantConstraints,
      locks: {
        courseIds: plannerLocks.courseIds,
        components: plannerLocks.components,
      },
      currentIssues: issues.map((issue) => ({
        course: issue.code,
        kind: issue.kind,
        text: issue.text,
      })),
      conflicts: overlapsFound.map((overlap) => ({
        first: `${overlap.a.course.code} ${overlap.a.meeting.type} Sec ${overlap.a.meeting.sec}`,
        second: `${overlap.b.course.code} ${overlap.b.meeting.type} Sec ${overlap.b.meeting.sec}`,
        minutes: overlap.minutes,
      })),
      selectedCourses: detailEntries.map((entry) => ({
        courseId: entry.course.id,
        code: entry.course.code,
        name: entry.course.name,
        credits: entry.course.credits ?? null,
        meetings: entry.pairing.meetings.map((meeting) => ({
          type: meeting.type,
          meetingId: uid(meeting),
          section: meeting.sec,
          day: meeting.day,
          time: formatRange(meeting.start, meeting.end),
          room: meeting.room || 'Not published',
          instructor: meetingOption(entry.course, meeting)?.instructor.name ?? entry.instructor.name,
        })),
      })),
      availableCourses: courses.map((course) => ({
        courseId: course.id,
        code: course.code,
        name: course.name,
        credits: course.credits ?? null,
        noFixedSchedule: course.noFixedSchedule === true,
        sections: course.instructors.flatMap((instructor) => [
          ...instructor.lectures.map((meeting) => ({
            type: meeting.type,
            meetingId: uid(meeting),
            section: meeting.sec,
            day: meeting.day,
            time: formatRange(meeting.start, meeting.end),
            room: meeting.room || 'Not published',
            instructor: instructor.name,
          })),
          ...instructor.labs.map((meeting) => ({
            type: meeting.type,
            meetingId: uid(meeting),
            section: meeting.sec,
            day: meeting.day,
            time: formatRange(meeting.start, meeting.end),
            room: meeting.room || 'Not published',
            instructor: instructor.name,
          })),
          ...instructor.tutorials.map((meeting) => ({
            type: meeting.type,
            meetingId: uid(meeting),
            section: meeting.sec,
            day: meeting.day,
            time: formatRange(meeting.start, meeting.end),
            room: meeting.room || 'Not published',
            instructor: instructor.name,
          })),
        ]),
      })),
    }),
    [
      major,
      yearPlan,
      effectiveCap,
      totalCredits,
      metrics,
      preferences,
      assistantConstraints,
      plannerLocks,
      issues,
      overlapsFound,
      detailEntries,
      courses,
      picks,
    ],
  );

  const scrollToBestSchedule = useCallback(() => {
    document
      .getElementById('best-schedule-heading')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const focusCourseFromCommand = useCallback((courseId: string) => {
    const el = document.getElementById(`course-card-${courseId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => el?.classList.add('course-focus-flash'), 180);
    window.setTimeout(() => el?.classList.remove('course-focus-flash'), 1100);
  }, []);

  const shareFromCommand = useCallback(() => {
    const btn = document.querySelector<HTMLButtonElement>('[data-share-primary="true"]');
    btn?.click();
  }, []);

  const copySummary = useCallback(() => {
    const lines: string[] = [
      `My Planora schedule — ${TERM_SESSION_PAREN_LABEL}`,
      '--------------------------------',
    ];

    detailEntries.forEach((e) => {
      lines.push(`${e.course.code} — ${e.course.name} · ${e.course.credits == null ? 'Credits not published' : `${e.course.credits} credits`}`);
      if (!e.pairing.meetings.length) lines.push('   No fixed schedule published');

      e.pairing.meetings.forEach((m) => {
        lines.push(
          `   ${m.type} Sec ${m.sec} · ${m.day} ${formatRange(m.start, m.end)} · ${m.room || 'Room not published'} · ${meetingOption(e.course, m)?.instructor.name ?? e.instructor.name}`,
        );
      });
    });

    lines.push('--------------------------------');
    lines.push(`Total known credits: ${totalCredits}${takenCourses.some(course => course.credits == null) ? ' (excludes courses with unverified credits)' : ''}`);
    lines.push(
      `Sessions: ${metrics.sessions} · Campus days: ${metrics.days} · ${formatDuration(
        metrics.gapMinutes,
      )} idle`,
    );

    const text = lines.join('\n');

    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();

      try {
        document.execCommand('copy');
        done();
      } catch {
        /* ignore */
      }

      document.body.removeChild(ta);
    }
  }, [detailEntries, metrics, totalCredits, takenCourses]);

  /* ---------------- render ---------------- */

  return (
    <div className="min-h-screen pb-14">
      <AppStatus />
      {sharedOnLoad&&<aside className="panel mx-auto my-3 max-w-7xl p-4 no-print"><h2 className="font-semibold">Shared planner preview</h2><p className="mt-1 text-sm">{saveSharedPlan?'You chose to save this shared plan on this device.':'Your existing local schedule is untouched. Changes to this shared preview are not saved until you choose to save them.'} {sharedOnLoad.legacySections?'This older link uses section positions, not stable identities. Verify every selected section against the current catalog.':''}</p>{!saveSharedPlan&&<button className="btn mt-3 px-3 py-2 text-sm" onClick={()=>{if(window.confirm('Replace the current local plan with this shared preview? This does not change any university registration.'))setSaveSharedPlan(true);}}>Save this shared plan on my device</button>}</aside>}
      <ScheduleImpact picks={picks} snapshot={savedOnLoad?.selectedSnapshot} />
      <CatalogUpdates />
      <EmailNotifications />
      <div className="mx-auto max-w-[1560px] px-3 py-4 sm:px-6 sm:py-6">
        <header className="panel mb-3 flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div>
            <p
              className="text-[10.5px] font-bold uppercase tracking-[0.09em]"
              style={{ color: 'var(--accent)' }}
            >
              {TERM_SESSION_LABEL}
            </p>

            <div className="mt-1 flex items-center gap-2.5">
              <img src={theme === 'dark' ? '/icons/planner-icon.svg' : '/icons/planner-icon-light.svg'} alt="" className="h-10 w-10 rounded-[12px]" />
              <div>
                <h1 className="text-[23px] font-extrabold tracking-[-0.03em] sm:text-[27px]">Planora</h1>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--brand-soft)' }}>
                  Build · Compare · Share
                </p>
              </div>
            </div>

            <p
              className="mt-1.5 max-w-[72ch] text-[12.5px] leading-relaxed"
              style={{ color: 'var(--muted)' }}
            >
              Tick the courses you are registering, then choose the lecture and lab/tutorial
              times you prefer — each component may come from a different instructor; every
              published section pairing is fair game. Real time intervals decide conflicts — a
              2:00–2:59 session next to a 3:00–3:59 session is fine, clashing ones are not.
            </p>
          </div>

          <div className="flex flex-none flex-wrap items-center gap-2">
            {major && !showAbout && (
              <span className="pill hidden sm:inline-flex" style={{ color: 'var(--accent)' }}>
                {major.title}
              </span>
            )}

            <button
              type="button"
              className="btn btn-tap"
              onClick={showAbout ? closeAbout : openAbout}
            >
              {showAbout ? '‹ Planner' : 'ℹ️ About'}
            </button>

            <a className="btn btn-tap" href="/admin.html" aria-label="Open Planora admin panel">
              🔒 Admin
            </a>

            <button type="button" className="btn btn-accent btn-tap" onClick={() => setFeedbackOpen(true)}>
              💬 Feedback
            </button>

            {major && !showAbout && (
              <button
                type="button"
                className="btn btn-tap"
                onClick={() => setCommandOpen(true)}
                title="Search courses and actions (Ctrl/Cmd + K)"
              >
                ⌕ Search
                <span className="pill hidden lg:inline-flex">⌘K</span>
              </button>
            )}

            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
        </header>

        {showAbout ? (
          <AboutPage onBack={closeAbout} />
        ) : !yearId ? (
          <div className="space-y-3">
            <EmptyState
              icon="🎓"
              title="Choose your year to begin planning your semester."
              message="Pick your academic year first; the next step shows the majors available for that year."
            />

            <section className="panel p-4 sm:p-5">
              <h2 className="text-[13px] font-bold tracking-tight">Choose Your Year</h2>

              <p
                className="mb-4 mt-1 text-[12px] leading-relaxed"
                style={{ color: 'var(--muted)' }}
              >
                You'll choose your major next. You can change either selection later.
              </p>

              <YearPicker selectedYearId={yearId} onSelect={selectYear} />
            </section>
          </div>
        ) : !major ? (
          <section className="panel p-4 sm:p-5">
            <h2 className="text-[13px] font-bold tracking-tight">Choose Your Major</h2>
            <p className="mb-4 mt-1 text-[12px]" style={{ color: 'var(--muted)' }}>For Year {yearId.slice(1)} · <button type="button" className="underline" onClick={() => setYearId(null)}>Change year</button></p>
            <MajorPicker selectedId={null} onSelect={selectMajor} yearId={yearId} />
          </section>
        ) : !yearPlan ? (
          <div className="space-y-3">
            <section className="panel p-3.5 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="pill" style={{ color: 'var(--accent)' }}>
                    Major
                  </span>

                  <div>
                    <p className="text-[13.5px] font-bold leading-tight">{major.title}</p>

                    <p
                      className="text-[11.5px]"
                      style={{ color: 'var(--muted)' }}
                    >
                      {major.subtitle}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-tap"
                  onClick={() => setShowMajorPicker((v) => !v)}
                  aria-expanded={showMajorPicker}
                >
                  {showMajorPicker ? 'Hide majors' : 'Change major'}
                </button>
              </div>

              {showMajorPicker && (
                <div className="mt-3">
                  <MajorPicker
                    selectedId={majorId}
                    onSelect={selectMajor}
                    compact
                    yearId={yearId}
                  />
                </div>
              )}
            </section>

            <section className="panel p-4 sm:p-5">
              <h2 className="text-[13px] font-bold tracking-tight">Choose Your Year</h2>

              <p
                className="mb-4 mt-1 text-[12px] leading-relaxed"
                style={{ color: 'var(--muted)' }}
              >
                Pick the academic year you're planning — its course list appears next. You can
                still add courses from the other years afterwards.
              </p>

              <YearPicker
                major={major}
                selectedYearId={yearId}
                onSelect={selectYear}
              />
            </section>
          </div>
        ) : (
          <div className="space-y-3">
            <section className="panel p-3.5 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="pill" style={{ color: 'var(--accent)' }}>
                    Major
                  </span>

                  <div>
                    <p className="text-[13.5px] font-bold leading-tight">{major.title}</p>

                    <p
                      className="text-[11.5px]"
                      style={{ color: 'var(--muted)' }}
                    >
                      {major.subtitle} · {yearPlan.label}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className="flex cursor-pointer items-center gap-1.5 text-[11.5px]"
                    style={{ color: 'var(--muted)' }}
                    title="Warn when a course publishes a lecture AND a lab/tutorial but only one of them has a time chosen"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                      checked={requireComplete}
                      onChange={(e) => setRequireComplete(e.target.checked)}
                    />

                    <span className="hidden sm:inline">Flag incomplete groups</span>
                    <span className="sm:hidden">Flag incomplete</span>
                  </label>

                  <button
                    type="button"
                    className="btn btn-tap"
                    onClick={() => setShowMajorPicker((v) => !v)}
                    aria-expanded={showMajorPicker}
                  >
                    {showMajorPicker ? 'Hide majors' : 'Change major'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-tap"
                    onClick={() => setShowYearPicker((v) => !v)}
                    aria-expanded={showYearPicker}
                  >
                    {showYearPicker ? 'Hide years' : 'Change year'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-tap"
                    onClick={requestClearAll}
                    disabled={takenCourses.length === 0}
                    title="Reset every selected course and section"
                  >
                    Clear All
                  </button>

                  <ShareSchedule
                    majorId={majorId!}
                    courses={courses}
                    picks={picks}
                    disabled={takenCourses.length === 0}
                    className="btn btn-accent btn-tap"
                    dataSharePrimary
                    extras={shareExtras}
                    summary={{
                      majorName: major.title,
                      selectedCount: takenCourses.length,
                      totalCredits,
                      conflictFree: takenCourses.length > 0 && noConflicts,
                    }}
                  />
                </div>
              </div>

              {showMajorPicker && (
                <div className="mt-3">
                  <MajorPicker
                    selectedId={majorId}
                    onSelect={selectMajor}
                    compact
                    yearId={yearId}
                  />
                </div>
              )}

              {showYearPicker && (
                <div className="mt-3">
                  <YearPicker
                    major={major}
                    selectedYearId={yearId}
                    onSelect={selectYear}
                    compact
                  />
                </div>
              )}
            </section>

            {!capNoteDismissed && (
              <CreditLimitNote
                onChoose={chooseCreditCap}
                onDismiss={dismissCapNote}
              />
            )}

            <CreditsDashboard
              selectedCount={takenCourses.length}
              courseCount={courses.length}
              totalCredits={totalCredits}
              freeHours={freeTime.freeHours}
              freeDays={freeTime.freeDays}
              occupiedMinutes={freeTime.occupiedMinutes}
              windowStart={WINDOW_START}
              windowEnd={WINDOW_END}
              overlapMinutes={freeTime.overlapMinutes}
              hiddenTotal={hiddenSummary.hidden}
              conflictTotal={hiddenSummary.conflicts}
              perDay={freeTime.perDay}
              onOpenBestSchedule={scrollToBestSchedule}
              onOpenPreferences={() => setPrefsOpen(true)}
              creditCap={effectiveCap}
              onChangeLimit={reopenCapNote}
            />
            {takenCourses.some(course => course.credits == null) && <p role="status" className="mt-2 text-xs" style={{ color: 'var(--warn)' }}>Some selected English levels have unverified credits. The number above counts known credits only; check your official credit limit before registration.</p>}

            <BestSchedule
              courses={takenCourses}
              majorId={major.id}
              picks={picks}
              preferences={preferences}
              shareExtras={shareExtras}
              prefsOpen={prefsOpen}
              onPrefsOpenChange={setPrefsOpen}
              onPreferencesChange={setPreferences}
              onUse={useGeneratedSchedule}
              locks={plannerLocks}
              assistantConstraints={assistantConstraints}
            />

            <div className="grid gap-3 xl:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
              <CoursePicker
                courses={courses}
                picks={picks}
                instructorFilter={instructorFilter}
                onInstructorFilter={setInstructorPinned}
                preferences={preferences}
                onChange={changePick}
                onToggle={toggleCourse}
                onClearOne={clearOne}
                yearBadges={yearBadges}
                onOpenCrossYear={() => setCrossYearOpen(true)}
                capNotice={capNotice}
                shake={capShake}
                onHoverCourse={setHoveredCourseId}
                locks={plannerLocks}
                onToggleCourseLock={toggleCourseLock}
                onToggleComponentLock={toggleComponentLock}
                onReportIssue={reportCourseIssue}
              />

              <div className="space-y-3">
                {takenCourses.length === 0 ? (
                  <EmptyState
                    icon="🗓"
                    title="Select an instructor to view available schedule combinations."
                    message="Tick at least one course on the left, then pick its lecture and lab/tutorial times. Nothing is generated until every component has a time."
                  />
                ) : (
                  <>
                    {overlapsFound.length > 0 && (
                      <div
                        className="rounded-xl border px-3.5 py-3 text-[12px] leading-relaxed"
                        style={{
                          borderColor: 'var(--warn-line)',
                          background:
                            'color-mix(in srgb, var(--warn-bg) 55%, var(--paper))',
                          color: 'var(--warn)',
                        }}
                        role="alert"
                      >
                        <strong>
                          {overlapsFound.length} time conflict
                          {overlapsFound.length > 1 ? 's' : ''} in your current picks.
                        </strong>{' '}
                        The overlapping blocks are outlined in red on the timetable. Change one
                        of the times, or browse a generated combination instead.

                        {generation && storedCount > 0 && (
                          <span className="mt-1 block">
                            {count.toLocaleString()} conflict-free combination
                            {count === 1 ? 's' : ''} exist
                            {count === 1 ? 's' : ''} for this selection — use the arrows below.
                          </span>
                        )}
                      </div>
                    )}

                    {issues.length > 0 && (
                      <div className="panel-soft px-3.5 py-3" aria-live="polite">
                        <p
                          className="text-[11px] font-bold uppercase tracking-[0.06em]"
                          style={{ color: 'var(--muted-2)' }}
                        >
                          Still to decide
                        </p>

                        <ul className="mt-1.5 space-y-1">
                          {issues.map((issue, i) => (
                            <li
                              key={i}
                              className="text-[12px] leading-snug"
                              style={{ color: 'var(--muted)' }}
                            >
                              • {issue.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {ready && (
                      <div
                        className="rounded-xl border-2 px-4 py-3 text-center text-[13.5px] font-bold"
                        style={{
                          borderColor: 'var(--ok)',
                          background:
                            'color-mix(in srgb, var(--ok) 12%, var(--paper))',
                          color: 'var(--ok)',
                        }}
                        role="status"
                      >
                        ✓ Ready to register — this selection has no time conflicts.
                      </div>
                    )}

                    {ready && count > 0 && (
                      <CombinationNav
                        index={safeIndex}
                        count={count}
                        onPrev={goPrev}
                        onNext={goNext}
                        onSuggest={suggestBest}
                        isBest={isCurrentComboBest}
                        bestIsComplete={best?.complete ?? true}
                      />
                    )}

                    <Filters
                      typeFilter={typeFilter}
                      onTypeFilter={setTypeFilter}
                      courseFilter={courseFilter}
                      onCourseFilter={setCourseFilter}
                      courses={takenCourses}
                    />

                    {allEvents.length === 0 ? (
                      <EmptyState
                        icon="🗓"
                        title="Select an instructor to view available schedule combinations."
                        message="Pick at least one lecture or lab/tutorial time from the cards on the left and it will appear here instantly."
                      />
                    ) : (
                      <div className="xl:sticky xl:top-3 xl:z-20">
                        <Timetable
                          events={visibleEvents}
                          hiddenCount={allEvents.length - visibleEvents.length}
                          bestLabel={bestLabel}
                          variant={noConflicts ? 'final' : 'draft'}
                          yearBadges={yearBadges}
                          highlightedCourseId={hoveredCourseId}
                        />
                      </div>
                    )}

                  </>
                )}
              </div>
            </div>

            {allEvents.length > 0 && (
              <div className="space-y-3">
                <StatsBar
                  metrics={metrics}
                  courseCount={detailEntries.length}
                  comboCount={count}
                  truncated={generation?.truncated ?? false}
                  countCapped={generation?.countCapped ?? false}
                />

                <ScheduleDetails
                  entries={detailEntries}
                  yearBadges={yearBadges}
                />

                <div className="panel flex flex-wrap items-center gap-2 p-3">
                  <ShareSchedule
                    majorId={majorId!}
                    courses={courses}
                    picks={picks}
                    disabled={takenCourses.length === 0}
                    className="btn btn-tap"
                    extras={shareExtras}
                    summary={{
                      majorName: major.title,
                      selectedCount: takenCourses.length,
                      totalCredits,
                      conflictFree: takenCourses.length > 0 && noConflicts,
                    }}
                  />

                  <ShareScheduleImage
                    events={allEvents}
                    title={`${major.title} · ${yearPlan.label}`}
                  />

                  <button
                    type="button"
                    className="btn btn-tap"
                    onClick={() => downloadCalendarIcs(draft)}
                    disabled={!canExport}
                    title="Download a weekly .ics calendar for Google Calendar, Apple Calendar or Outlook"
                  >
                    📅 Export Calendar (.ics)
                  </button>

                  <InstallAppButton />

                  <button
                    type="button"
                    className="btn btn-tap"
                    onClick={() => window.print()}
                    disabled={!canExport}
                  >
                    Print / Save PDF
                  </button>

                  <button
                    type="button"
                    className="btn btn-tap"
                    onClick={copySummary}
                    disabled={!canExport}
                  >
                    {copied ? '✓ Copied' : 'Copy summary'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-tap"
                    onClick={requestClearAll}
                    title="Reset every selected course and section"
                  >
                    Clear All
                  </button>

                  {engineInSync && (
                    <span
                      className="pill ml-auto"
                      style={{ color: 'var(--ok)' }}
                    >
                      ✓ matches combination {safeIndex + 1}
                    </span>
                  )}
                </div>

                <p
                  className="px-1 text-center text-[11px] leading-relaxed"
                  style={{ color: 'var(--muted-2)' }}
                >
                  Conflict rule: two meetings clash only on the same day when{' '}
                  <span className="mono">startA &lt; endB</span> and{' '}
                  <span className="mono">startB &lt; endA</span> — back-to-back sessions
                  (2:00–2:59 then 3:00–3:59) are allowed, while 2:00–3:59 and 3:00–4:59
                  clash. Non-credit tutorials and labs still count. Use ← / → to browse.
                </p>
              </div>
            )}
          </div>
        )}

        <footer
          className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center text-[11px]"
          style={{ color: 'var(--muted-2)' }}
        >
          <span>Planora · Version 2.1</span>

          <span aria-hidden>·</span>

          <button
            type="button"
            className="underline decoration-dotted underline-offset-2"
            onClick={showAbout ? closeAbout : openAbout}
          >
            About &amp; GitHub
          </button>

          <span aria-hidden>·</span>

          <span>
            Course data verified:{' '}
            {new Date(`${courseDataLastVerified()}T12:00:00`).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>

          <span aria-hidden>·</span>

          <button
            type="button"
            className="underline decoration-dotted underline-offset-2"
            onClick={reportGeneralIssue}
          >
            Report an issue
          </button>
          <span aria-hidden>·</span>
          <button type="button" className="underline decoration-dotted underline-offset-2" onClick={() => setFeedbackOpen(true)}>Feedback</button>
        </footer>

        <p
          className="mt-2 text-center text-[10px] font-bold uppercase tracking-[0.14em]"
          style={{ color: 'var(--accent)' }}
        >
          {CREATOR_CREDIT}
        </p>
      </div>

      {/* Mobile quick-action bar: the primary workflow (generate → preferences → share) stays
          one tap away while scrolling the course list on small screens. */}
      {major && !showAbout && takenCourses.length > 0 && (
        <nav
          className="mobile-actionbar no-print"
          aria-label="Quick schedule actions"
        >
          <button
            type="button"
            className="btn btn-accent btn-tap flex-1"
            onClick={scrollToBestSchedule}
          >
            ✦ Best
          </button>

          <button
            type="button"
            className="btn btn-tap flex-1"
            onClick={() => setMobileScheduleOpen(true)}
            disabled={allEvents.length === 0}
          >
            🗓 Schedule
          </button>

          <button
            type="button"
            className="btn btn-tap flex-1"
            onClick={() => setPrefsOpen(true)}
          >
            ⚙ Preferences
          </button>
        </nav>
      )}

      {mobileScheduleOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 p-0 sm:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Current schedule"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMobileScheduleOpen(false);
          }}
        >
          <div className="panel max-h-[88vh] w-full overflow-y-auto rounded-b-none rounded-t-2xl p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-[14px] font-bold">Current Schedule</h2>
                <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  Updates instantly as you change sections.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-tap px-3"
                onClick={() => setMobileScheduleOpen(false)}
                aria-label="Close current schedule"
              >
                ✕
              </button>
            </div>
            {allEvents.length === 0 ? (
              <EmptyState
                icon="🗓"
                title="No times selected yet."
                message="Choose a lecture, lab or tutorial and it will appear here."
              />
            ) : (
              <Timetable
                events={visibleEvents}
                hiddenCount={allEvents.length - visibleEvents.length}
                bestLabel={bestLabel}
                variant={noConflicts ? 'final' : 'draft'}
                yearBadges={yearBadges}
                highlightedCourseId={hoveredCourseId}
              />
            )}
          </div>
        </div>
      )}

      {major && yearPlan && !showAbout && <ScheduleAssistant
        context={assistantContext}
        onPreviewProposal={previewAssistantProposal}
        onApplyProposal={applyAssistantProposal}
        constraints={assistantConstraints}
        onAddConstraints={addAssistantConstraints}
        onRemoveConstraint={removeAssistantConstraint}
        onLockActions={applyAssistantLockActions}
      />}

      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        courses={courses}
        onSelectCourse={focusCourseFromCommand}
        onBestSchedule={scrollToBestSchedule}
        onPreferences={() => setPrefsOpen(true)}
        onShare={shareFromCommand}
      />

      {reportTarget && (
        <ReportIssueDialog
          course={reportTarget.courseId ? COURSE_BY_ID[reportTarget.courseId] : undefined}
          pick={reportTarget.courseId ? picks[reportTarget.courseId] : undefined}
          onClose={() => setReportTarget(null)}
        />
      )}
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
      <Toast toast={toast} onClose={() => setToast(null)} />

      {crossYearOpen && major && yearPlan && (
        <CrossYearBrowser
          major={major}
          currentYearId={yearPlan.id}
          picks={picks}
          onToggle={toggleCourse}
          onClose={() => setCrossYearOpen(false)}
          capNotice={capNotice}
          shake={capShake}
        />
      )}

      {confirmClearOpen && (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirm clear entire schedule"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmClearOpen(false);
          }}
        >
          <div className="panel w-full max-w-[420px] rounded-b-none p-5 sm:rounded-2xl">
            <h2 className="text-[15px] font-bold tracking-tight">
              Clear entire schedule?
            </h2>

            <p
              className="mt-2 text-[13px] leading-relaxed"
              style={{ color: 'var(--muted)' }}
            >
              This will remove all selected courses, sections and instructor filters. Your saved
              schedule preferences won't be affected.
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="btn btn-tap"
                onClick={() => setConfirmClearOpen(false)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="btn btn-tap"
                style={{
                  background: 'var(--warn)',
                  color: '#fff',
                  borderColor: 'transparent',
                }}
                onClick={performClearAll}
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

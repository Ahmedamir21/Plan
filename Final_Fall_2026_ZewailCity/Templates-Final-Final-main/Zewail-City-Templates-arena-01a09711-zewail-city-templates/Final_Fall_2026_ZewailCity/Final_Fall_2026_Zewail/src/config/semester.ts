/**
 * Semester facts arrive from the SQL-backed catalog API. This adapter should stay stable.
 * Product logic should never hard-code a semester name.
 */
/**
 * Pre-semester-key share links/local state were all created for Fall 2026.
 * Keep this constant unchanged forever; it lets future terms reject old
 * untagged state safely instead of interpreting it against new data.
 */
export const LEGACY_UNTAGGED_SEMESTER_KEY = 'fall-2026-main';

export interface SemesterConfig {
  key:string; institution:string; plannerName:string; term:string; year:number; session:string;
  version:string; dataLastVerified:string; calendarStartDate:string; calendarEndDate:string; publicHostLabel:string;
}
// Product labels are available while loading; all academic facts arrive from SQL.
export const SEMESTER_CONFIG: SemesterConfig = { key:'',institution:'Zewail City',plannerName:'Planora',term:'',year:0,session:'',version:'',dataLastVerified:'',calendarStartDate:'',calendarEndDate:'',publicHostLabel:'' };

export let TERM_LABEL = `${SEMESTER_CONFIG.term} ${SEMESTER_CONFIG.year}`;
export let TERM_SESSION_LABEL = `${TERM_LABEL} · ${SEMESTER_CONFIG.session}`;
export let TERM_SESSION_PAREN_LABEL = `${TERM_LABEL} (${SEMESTER_CONFIG.session})`;
export let PRODUCT_TITLE = `Planora — ${TERM_LABEL} Student Schedule Planner`;
export let SHARE_TITLE = `My ${TERM_LABEL} schedule`;
export let SHARE_TEXT = `Check out my ${TERM_LABEL} schedule on Planora.`;

export let DOCUMENT_TITLE = PRODUCT_TITLE;
export const DOCUMENT_DESCRIPTION = `Planora is a student-built schedule planner for choosing courses and sections, detecting conflicts, comparing schedules, and sharing the final plan.`;

export const CREATOR_CREDIT = 'Directed by Ahmed Amir & Youssef Taha (الريبات المشطشطين)';

export function hydrateSemester(config: SemesterConfig) {
  Object.assign(SEMESTER_CONFIG,config);
  TERM_LABEL = `${config.term} ${config.year}`;
  TERM_SESSION_LABEL = `${TERM_LABEL} · ${config.session}`;
  TERM_SESSION_PAREN_LABEL = `${TERM_LABEL} (${config.session})`;
  PRODUCT_TITLE = `Planora — ${TERM_LABEL} Student Schedule Planner`;
  SHARE_TITLE = `My ${TERM_LABEL} schedule`;
  SHARE_TEXT = `Check out my ${TERM_LABEL} schedule on Planora.`;
  DOCUMENT_TITLE = PRODUCT_TITLE;
}

import type { Course, Instructor } from '../types';
import { SCH_ELECTIVE_COURSES, SCH_ELECTIVE_COURSE_IDS } from './schElectives';

/** Populated from the SQL-backed API before mounting; no production JSON seed. */
export const COURSES: Course[] = [];
export const COURSE_BY_ID: Record<string, Course> = Object.create(null);
export const ENGLISH_LEVEL_COURSE_IDS: string[] = [];
export function hydrateCatalog(courses: Course[], sch: Course[]) {
  if (![courses,sch].every(list => Array.isArray(list) && list.length > 0 && list.every(c => c && typeof c.id === 'string' && c.id !== '__proto__' && typeof c.code === 'string' && typeof c.name === 'string' && Array.isArray(c.instructors)))) return false;
  const combined = [...courses,...sch];
  if (new Set(combined.map(c => c.id)).size !== combined.length) return false;
  SCH_ELECTIVE_COURSES.splice(0,SCH_ELECTIVE_COURSES.length,...sch);
  SCH_ELECTIVE_COURSE_IDS.splice(0,SCH_ELECTIVE_COURSE_IDS.length,...sch.map(c => c.id));
  COURSES.splice(0,COURSES.length,...combined);
  for (const id of Object.keys(COURSE_BY_ID)) delete COURSE_BY_ID[id];
  for (const c of combined) COURSE_BY_ID[c.id] = c;
  ENGLISH_LEVEL_COURSE_IDS.splice(0,ENGLISH_LEVEL_COURSE_IDS.length,...combined.filter(c => ENGLISH_LEVEL_CODES.some(code => code===c.code)).map(c => c.id));
  return true;
}
/** Offer verified English levels as choices without inventing unpublished course metadata. */
export const ENGLISH_LEVEL_CODES = ['ENGL 003', 'ENGL 004', 'ENGL 156', 'ENGL 157'] as const;
export function instructorLabel(instructor: Instructor): string {
  return instructor.unassigned ? `${instructor.name} (unassigned)` : instructor.name;
}

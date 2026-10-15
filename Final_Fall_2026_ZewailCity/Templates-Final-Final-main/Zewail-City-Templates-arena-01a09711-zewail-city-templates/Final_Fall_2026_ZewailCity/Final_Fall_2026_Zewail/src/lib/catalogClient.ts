import { hydrateCatalog } from '../data/courses';
import { hydrateMajors } from '../data/majors';
import { hydrateSemester, type SemesterConfig } from '../config/semester';
import type { Course, Major } from '../types';
export interface CatalogPayload {
  courses: Course[];
  sch: Course[];
  majors: Major[];
  semester: SemesterConfig;
  revision: number;
  publishedAt: string;
  hash: string;
  source: 'postgresql';
  schemaVersion: 1;
}
export const CATALOG_CACHE_KEY = 'planora-sql-catalog-v1';
export let catalogFresh = false;
export let catalogRevision = 0;
export let catalogPublishedAt = '';
export function validateCatalog(value: unknown): value is CatalogPayload {
  const x = value as CatalogPayload;
  if (
    !x ||
    x.source !== 'postgresql' ||
    x.schemaVersion !== 1 ||
    !Number.isInteger(x.revision) ||
    x.revision < 1 ||
    !x.semester ||
    typeof x.semester.key !== 'string' ||
    !x.semester.key ||
    !Array.isArray(x.majors) ||
    !x.majors.length
  )
    return false;
  const ids = new Set<string>();
  for (const list of [x.courses, x.sch]) {
    if (!Array.isArray(list) || !list.length) return false;
    for (const c of list) {
      if (
        !c ||
        !c.id ||
        ['__proto__', 'constructor', 'prototype'].includes(c.id) ||
        ids.has(c.id) ||
        typeof c.code !== 'string' ||
        typeof c.name !== 'string' ||
        !Array.isArray(c.instructors)
      )
        return false;
      ids.add(c.id);
      for (const t of c.instructors) {
        if (!t || typeof t.name !== 'string') return false;
        for (const [index, bucket] of [
          'lectures',
          'labs',
          'tutorials',
        ].entries()) {
          const items = t[bucket as 'lectures' | 'labs' | 'tutorials'];
          if (!Array.isArray(items)) return false;
          for (const m of items)
            if (
              !m ||
              m.type !== ['Lecture', 'Lab', 'Tutorial'][index] ||
              typeof m.sec !== 'string' ||
              !m.sec ||
              !['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(m.day) ||
              !Number.isInteger(m.start) ||
              !Number.isInteger(m.end) ||
              m.start < 0 ||
              m.end > 1440 ||
              m.start >= m.end ||
              typeof m.room !== 'string'
            )
              return false;
        }
      }
    }
  }
  return x.majors.every(
    (m) =>
      m &&
      typeof m.id === 'string' &&
      Array.isArray(m.years) &&
      m.years.every(
        (y) =>
          Array.isArray(y.courseIds) && y.courseIds.every((id) => ids.has(id))
      )
  );
}
export function installCatalog(data: CatalogPayload, fresh = true) {
  if (!validateCatalog(data) || !hydrateCatalog(data.courses, data.sch))
    throw new Error(
      'The catalog is incompatible. Saved schedules were not changed.'
    );
  hydrateSemester(data.semester);
  hydrateMajors(data.majors);
  catalogFresh = fresh;
  catalogRevision = data.revision;
  catalogPublishedAt = data.publishedAt;
}
export async function fetchCatalog(): Promise<CatalogPayload> {
  const response = await fetch('/api/catalog', {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error(
      'The SQL catalog is unavailable. Your saved schedule is still on this device.'
    );
  const data: unknown = await response.json();
  if (!validateCatalog(data))
    throw new Error(
      'Catalog validation failed. Your saved schedule was not changed.'
    );
  installCatalog(data);
  try {
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* Public offline cache is optional. */
  }
  return data;
}
export function cachedCatalog(): CatalogPayload | null {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    const data: unknown = raw ? JSON.parse(raw) : null;
    return validateCatalog(data) ? data : null;
  } catch {
    return null;
  }
}

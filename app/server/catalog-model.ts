import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SafeError } from './errors';

const clean = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const text = (max: number) => z.string().max(max).transform(clean);
const nonempty = (max: number) => text(max).pipe(z.string().min(1));
const id = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/)
  .refine((value) => !['constructor', 'prototype'].includes(value));
const optionalText = (max: number) => nonempty(max).optional();
const days: Record<string, string> = {
  sunday: 'Sun',
  sun: 'Sun',
  monday: 'Mon',
  mon: 'Mon',
  tuesday: 'Tue',
  tue: 'Tue',
  wednesday: 'Wed',
  wed: 'Wed',
  thursday: 'Thu',
  thu: 'Thu',
};
export const meetingSchema = z
  .object({
    type: z.enum(['Lecture', 'Lab', 'Tutorial']),
    sec: nonempty(80).refine((value) => !value.includes('|')),
    day: z
      .string()
      .transform((s) => days[s.trim().toLowerCase()] ?? s)
      .pipe(z.enum(['Sun', 'Mon', 'Tue', 'Wed', 'Thu'])),
    start: z.number().int().min(0).max(1439),
    end: z.number().int().min(1).max(1440),
    room: text(200),
    sourceId: optionalText(200),
  })
  .strict()
  .refine((m) => m.end > m.start, 'End must be after start.');
export const courseSchema = z
  .object({
    id,
    code: nonempty(80).transform((s) => s.toUpperCase()),
    name: nonempty(500),
    c: z.number().int().min(1).max(7),
    credits: z.number().min(0).max(21).optional(),
    group: optionalText(100),
    noFixedSchedule: z.boolean().optional(),
    awaitingSource: z.boolean().optional(),
    sourceId: optionalText(200),
    instructors: z.array(
      z
        .object({
          name: nonempty(300),
          note: text(1000).optional(),
          unassigned: z.boolean().optional(),
          lectures: z.array(meetingSchema),
          labs: z.array(meetingSchema),
          tutorials: z.array(meetingSchema),
        })
        .strict()
    ),
  })
  .strict();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s
  );
const semesterSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    institution: nonempty(200),
    plannerName: nonempty(100),
    term: nonempty(80),
    year: z.number().int().min(2020).max(2200),
    session: nonempty(100),
    version: nonempty(40),
    dataLastVerified: date,
    calendarStartDate: date,
    calendarEndDate: date,
    publicHostLabel: nonempty(200),
  })
  .strict();
export const datasetSchema = z
  .object({
    semester: semesterSchema,
    courses: z.array(courseSchema),
    sch: z.array(courseSchema),
    majors: z.array(
      z
        .object({
          id,
          title: nonempty(200),
          subtitle: text(500),
          blurb: text(2000),
          years: z.array(
            z
              .object({
                id: z.enum(['y1', 'y2', 'y3', 'y4']),
                label: nonempty(100),
                courseIds: z.array(id),
              })
              .strict()
          ),
        })
        .strict()
    ),
  })
  .strict();
export type Dataset = z.infer<typeof datasetSchema>;
export type Course = Dataset['courses'][number];
export type Meeting = z.infer<typeof meetingSchema>;
export type CatalogKey = 'courses' | 'sch';
export const catalogKeys: CatalogKey[] = ['courses', 'sch'];
export const buckets = ['lectures', 'labs', 'tutorials'] as const;
export const sectionKey = (m: Meeting) =>
  m.sourceId ? `source:${m.sourceId}` : `display:${m.type}:${m.sec}`;
export function sectionRows(c: Course) {
  return c.instructors.flatMap((i) =>
    buckets.flatMap((bucket) =>
      i[bucket].map((m) => ({
        ...m,
        instructor: i.name,
        ...(i.unassigned !== undefined ? { unassigned: i.unassigned } : {}),
      }))
    )
  );
}
export function normalizeDataset(input: unknown): {
  dataset: Dataset;
  warnings: string[];
} {
  const parsed = datasetSchema.safeParse(input);
  if (!parsed.success)
    throw new SafeError(
      'CATALOG_VALIDATION_FAILED',
      422,
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.code}`
      )
    ); // Do not echo attacker-provided values.
  const dataset = parsed.data,
    errors: string[] = [],
    warnings: string[] = [];
  const ids = new Set<string>();
  if (!dataset.courses.length || !dataset.sch.length)
    errors.push(
      'Both established catalogs must be nonempty. Empty catalogs require a separately reviewed term migration.'
    );
  if (dataset.semester.calendarStartDate > dataset.semester.calendarEndDate)
    errors.push('Invalid semester date range.');
  for (const key of catalogKeys) {
    const codes = new Set<string>(),
      sources = new Set<string>();
    for (const course of dataset[key]) {
      if (ids.has(course.id))
        errors.push('Duplicate term-scoped legacy course ID.');
      ids.add(course.id);
      if (codes.has(course.code))
        errors.push(`Duplicate course code in ${key}.`);
      codes.add(course.code);
      if (course.sourceId && sources.has(course.sourceId))
        errors.push(`Duplicate source course ID in ${key}.`);
      if (course.sourceId) sources.add(course.sourceId);
      const labels = new Set<string>(),
        sectionSources = new Set<string>();
      for (const [i, teacher] of course.instructors.entries()) {
        if (
          /^(instructor not assigned|tba)$/i.test(teacher.name) &&
          teacher.unassigned !== true
        )
          errors.push(`${course.id}: unassigned marker missing.`);
        for (const [index, bucket] of buckets.entries())
          for (const meeting of teacher[bucket]) {
            if (meeting.type !== ['Lecture', 'Lab', 'Tutorial'][index])
              errors.push(`${course.id}: wrong component bucket.`);
            const label = `${meeting.type}:${meeting.sec}`;
            if (labels.has(label))
              errors.push(
                `${course.id}: duplicate section or unsupported linked multi-meeting section.`
              );
            labels.add(label);
            if (meeting.sourceId && sectionSources.has(meeting.sourceId))
              errors.push(`${course.id}: duplicate section source ID.`);
            if (meeting.sourceId) sectionSources.add(meeting.sourceId);
            if (!meeting.room)
              warnings.push(`${course.id}/${label}: room not published.`);
          }
        if (teacher.unassigned)
          warnings.push(
            `${course.id}/instructor-${i + 1}: instructor unassigned.`
          );
      }
      const pending = course.awaitingSource === true;
      if (
        pending &&
        (!/^ENGL (003|004|156|157)$/.test(course.code) ||
          !course.noFixedSchedule ||
          course.name !== course.code ||
          course.credits !== undefined ||
          course.instructors.length)
      )
        errors.push(`${course.id}: invalid unpublished English shell.`);
      if (!pending && !course.instructors.length)
        errors.push(`${course.id}: missing instructor groups.`);
      if (course.noFixedSchedule ? labels.size !== 0 : labels.size === 0)
        errors.push(
          `${course.id}: fixed-schedule flag disagrees with meetings.`
        );
    }
  }
  const majorIds = new Set<string>();
  for (const major of dataset.majors) {
    if (majorIds.has(major.id)) errors.push('Duplicate major ID.');
    majorIds.add(major.id);
    const years = new Set<string>();
    for (const year of major.years) {
      if (years.has(year.id)) errors.push('Duplicate year ID.');
      years.add(year.id);
      if (
        new Set(year.courseIds).size !== year.courseIds.length ||
        year.courseIds.some((id) => !ids.has(id))
      )
        errors.push(`${major.id}/${year.id}: invalid course references.`);
    }
  }
  if (errors.length)
    throw new SafeError('CATALOG_VALIDATION_FAILED', 422, errors);
  return { dataset, warnings };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Ignore record ordering (not major/year order), whitespace and object key order in academic comparisons. */
export function semanticDataset(data: Dataset) {
  return {
    ...data,
    ...Object.fromEntries(
      catalogKeys.map((key) => [
        key,
        data[key]
          .map((c) => ({
            ...c,
            instructors: c.instructors
              .map((i) => ({
                ...i,
                ...Object.fromEntries(
                  buckets.map((b) => [
                    b,
                    [...i[b]].sort((a, b) =>
                      sectionKey(a).localeCompare(sectionKey(b))
                    ),
                  ])
                ),
              }))
              .sort((a, b) => canonical(a).localeCompare(canonical(b))),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ])
    ),
  };
}
export const datasetHash = (d: Dataset) => sha(canonical(semanticDataset(d)));
export function counts(d: Dataset) {
  const courses = [...d.courses, ...d.sch];
  return {
    courses: courses.length,
    sections: courses.reduce((sum, c) => sum + sectionRows(c).length, 0),
    instructors: courses.reduce((sum, c) => sum + c.instructors.length, 0),
  };
}

import {
  buckets,
  catalogKeys,
  normalizeDataset,
  type Dataset,
} from './catalog-model';
import { SafeError } from './errors';
/** Missing optional facts are not evidence that a published fact was deleted. */
export function mergeSourceCatalog(
  current: Dataset,
  incoming: { courses: any[]; sch: any[] }
): Dataset {
  const candidate = structuredClone(current);
  for (const catalog of catalogKeys)
    candidate[catalog] = incoming[catalog].map((row) => {
      const previous =
        current[catalog].find(
          (c) => row.sourceId && c.sourceId === row.sourceId
        ) || current[catalog].find((c) => c.id === row.id);
      if (
        !previous &&
        current[catalog].some(
          (c) =>
            c.code ===
            String(row.code).trim().replace(/\s+/g, ' ').toUpperCase()
        )
      )
        throw new SafeError('SOURCE_COURSE_IDENTITY_UNVERIFIED', 422);
      if (
        previous?.sourceId &&
        row.sourceId &&
        previous.sourceId !== row.sourceId
      )
        throw new SafeError('SOURCE_COURSE_IDENTITY_CONFLICT', 422);
      const course = structuredClone(row);
      if (previous) {
        course.id = previous.id;
        course.c = previous.c;
        for (const field of [
          'credits',
          'group',
          'sourceId',
          'noFixedSchedule',
          'awaitingSource',
        ] as const)
          if (course[field] == null) {
            if (previous[field] !== undefined) course[field] = previous[field];
            else delete course[field];
          }
        const before = previous.instructors.flatMap((i) =>
          buckets.flatMap((b) => i[b])
        );
        for (const instructor of course.instructors) {
          const teacher = previous.instructors.find(
            (i) => i.name === instructor.name
          );
          for (const field of ['note', 'unassigned'])
            if (instructor[field] == null) {
              if (teacher && (teacher as any)[field] !== undefined)
                instructor[field] = (teacher as any)[field];
              else delete instructor[field];
            }
          for (const bucket of buckets)
            for (const meeting of instructor[bucket]) {
              const old =
                before.find(
                  (m) => meeting.sourceId && m.sourceId === meeting.sourceId
                ) ||
                before.find(
                  (m) => m.type === meeting.type && m.sec === meeting.sec
                );
              if (
                old?.sourceId &&
                meeting.sourceId &&
                old.sourceId !== meeting.sourceId
              )
                throw new SafeError('SOURCE_SECTION_IDENTITY_CONFLICT', 422);
              if (meeting.sourceId == null) {
                if (old?.sourceId) meeting.sourceId = old.sourceId;
                else delete meeting.sourceId;
              }
              if (meeting.room == null || meeting.room === '')
                meeting.room = old?.room || '';
            }
        }
        if (
          previous.awaitingSource &&
          course.instructors.some((i: any) => buckets.some((b) => i[b].length))
        ) {
          delete course.awaitingSource;
          delete course.noFixedSchedule;
          if (course.name === previous.code || course.credits === undefined)
            throw new SafeError('SOURCE_INCOMPLETE_ENGLISH_METADATA', 422);
        }
      }
      return course;
    });
  // Retire offerings without inventing new academic requirements. Additions need editorial mapping.
  const ids = new Set(
    [...candidate.courses, ...candidate.sch].map((c) => c.id)
  );
  for (const major of candidate.majors)
    for (const year of major.years)
      year.courseIds = year.courseIds.filter((id) => ids.has(id));
  return normalizeDataset(candidate).dataset;
}

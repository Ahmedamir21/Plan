import { randomUUID } from 'node:crypto';
import type { Database, Sql } from './db.js';
import { SafeError } from './errors.js';
import {
  buckets,
  canonical,
  catalogKeys,
  counts,
  datasetHash,
  normalizeDataset,
  sectionKey,
  type Course,
  type Dataset,
} from './catalog-model.js';

export type Catalog = {
  dataset: Dataset;
  revision: number;
  publishedAt: string;
  hash: string;
};
export async function readCatalog(sql: Sql, term: string): Promise<Catalog> {
  const state = (
    await sql.query(
      `SELECT s.*, t.metadata FROM planora.catalog_state s JOIN planora.terms t ON t.key=s.term_key WHERE s.term_key=$1`,
      [term]
    )
  ).rows[0];
  if (!state) throw new SafeError('CATALOG_NOT_IMPORTED', 503);
  const courses = (
    await sql.query(
      `SELECT * FROM planora.courses WHERE term_key=$1 AND active ORDER BY catalog_key, position`,
      [term]
    )
  ).rows;
  const groups = (
    await sql.query(
      `SELECT i.* FROM planora.instructor_groups i JOIN planora.courses c ON c.id=i.course_id WHERE c.term_key=$1 AND c.active AND i.active ORDER BY i.position`,
      [term]
    )
  ).rows;
  const meetings = (
    await sql.query(
      `SELECT s.*, m.* FROM planora.sections s JOIN planora.courses c ON c.id=s.course_id JOIN planora.meetings m ON m.section_id=s.id WHERE c.term_key=$1 AND c.active AND s.active ORDER BY s.position,m.position`,
      [term]
    )
  ).rows;
  const dataset: Dataset = {
    semester: state.metadata,
    courses: [],
    sch: [],
    majors: [],
  };
  const byUuid = new Map<string, Course>(),
    groupMap = new Map<string, Course['instructors'][number]>();
  for (const c of courses) {
    const row: Course = {
      id: c.legacy_id,
      code: c.code,
      name: c.title,
      c: c.palette,
      instructors: [],
      ...(c.credits !== null ? { credits: Number(c.credits) } : {}),
      ...(c.course_group !== null ? { group: c.course_group } : {}),
      ...(c.no_fixed_schedule !== null
        ? { noFixedSchedule: c.no_fixed_schedule }
        : {}),
      ...(c.awaiting_source !== null
        ? { awaitingSource: c.awaiting_source }
        : {}),
      ...(c.source_id !== null ? { sourceId: c.source_id } : {}),
    };
    byUuid.set(c.id, row);
    dataset[c.catalog_key as 'courses' | 'sch'].push(row);
  }
  for (const g of groups) {
    const row: Course['instructors'][number] = {
      name: g.name,
      lectures: [],
      labs: [],
      tutorials: [],
      ...(g.note !== null ? { note: g.note } : {}),
      ...(g.unassigned !== null ? { unassigned: g.unassigned } : {}),
    };
    byUuid.get(g.course_id)!.instructors.push(row);
    groupMap.set(g.id, row);
  }
  for (const m of meetings)
    groupMap
      .get(m.instructor_group_id)!
      [
        m.kind === 'Lecture'
          ? 'lectures'
          : m.kind === 'Lab'
            ? 'labs'
            : 'tutorials'
      ].push({
        type: m.kind,
        sec: m.label,
        day: m.weekday,
        start: m.start_minute,
        end: m.end_minute,
        room: m.room,
        ...(m.source_id !== null ? { sourceId: m.source_id } : {}),
      });
  const majors = (
    await sql.query(
      `SELECT * FROM planora.majors WHERE term_key=$1 ORDER BY position`,
      [term]
    )
  ).rows;
  const years = (
    await sql.query(
      `SELECT * FROM planora.year_plans WHERE term_key=$1 ORDER BY position`,
      [term]
    )
  ).rows;
  const references = (
    await sql.query(
      `SELECT y.*,c.legacy_id FROM planora.year_plan_courses y JOIN planora.courses c ON c.id=y.course_id WHERE y.term_key=$1 AND c.active ORDER BY y.position`,
      [term]
    )
  ).rows;
  dataset.majors = majors.map((m) => ({
    id: m.id,
    title: m.title,
    subtitle: m.subtitle,
    blurb: m.blurb,
    years: years
      .filter((y) => y.major_id === m.id)
      .map((y) => ({
        id: y.id,
        label: y.label,
        courseIds: references
          .filter((r) => r.major_id === m.id && r.year_id === y.id)
          .map((r) => r.legacy_id),
      })),
  }));
  return {
    dataset,
    revision: state.revision,
    hash: state.content_hash,
    publishedAt: new Date(state.published_at).toISOString(),
  };
}
export function getCatalog(db: Database, term: string) {
  return db.transaction((sql) => readCatalog(sql, term), true);
}

/** Called only inside an already locked publication/import transaction. Retire, never erase courses. */
export async function writeCatalog(
  sql: Sql,
  dataset: Dataset,
  previous?: Dataset
) {
  const term = dataset.semester.key;
  await sql.query(
    `INSERT INTO planora.terms(key,metadata) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET metadata=EXCLUDED.metadata`,
    [term, JSON.stringify(dataset.semester)]
  );
  for (const key of catalogKeys)
    await sql.query(
      `INSERT INTO planora.catalogs(term_key,key) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [term, key]
    );
  const existingCourses = (
    await sql.query(
      `SELECT id,legacy_id,catalog_key,position FROM planora.courses WHERE term_key=$1`,
      [term]
    )
  ).rows;
  const coursesByLegacy = new Map(existingCourses.map((c) => [c.legacy_id, c]));
  const incomingIds = new Set(
    [...dataset.courses, ...dataset.sch].map((c) => c.id)
  );
  // Keep relationships and audit identity for retired courses; a failed transaction restores all flags.
  await sql.query(
    `UPDATE planora.courses SET active=false WHERE term_key=$1 AND NOT (legacy_id=ANY($2::text[]))`,
    [term, [...incomingIds]]
  );
  for (const catalog of catalogKeys)
    for (const [pos, c] of dataset[catalog].entries()) {
      const old = coursesByLegacy.get(c.id);
      if (old && old.catalog_key !== catalog)
        throw new SafeError('COURSE_CATALOG_IDENTITY_CHANGED', 422);
      const courseId = old?.id || randomUUID();
      const prior = previous?.[catalog].find((item) => item.id === c.id);
      if (prior && canonical(prior) === canonical(c)) continue;
      await sql.query(
        `INSERT INTO planora.courses(id,term_key,catalog_key,legacy_id,code,title,palette,credits,course_group,no_fixed_schedule,awaiting_source,source_id,position,active)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true) ON CONFLICT(term_key,legacy_id) DO UPDATE SET
      code=EXCLUDED.code,title=EXCLUDED.title,palette=EXCLUDED.palette,credits=EXCLUDED.credits,course_group=EXCLUDED.course_group,
      no_fixed_schedule=EXCLUDED.no_fixed_schedule,awaiting_source=EXCLUDED.awaiting_source,source_id=EXCLUDED.source_id,position=EXCLUDED.position,active=true`,
        [
          courseId,
          term,
          catalog,
          c.id,
          c.code,
          c.name,
          c.c,
          c.credits ?? null,
          c.group ?? null,
          c.noFixedSchedule ?? null,
          c.awaitingSource ?? null,
          c.sourceId ?? null,
          old?.position ??
            existingCourses.filter((item) => item.catalog_key === catalog)
              .length + pos,
        ]
      );
      const oldGroups = (
        await sql.query(
          `SELECT id,position FROM planora.instructor_groups WHERE course_id=$1`,
          [courseId]
        )
      ).rows;
      const oldSections = (
        await sql.query(
          `SELECT id,identity_key,kind,label,source_id FROM planora.sections WHERE course_id=$1`,
          [courseId]
        )
      ).rows;
      await sql.query(
        `UPDATE planora.instructor_groups SET active=false WHERE course_id=$1`,
        [courseId]
      );
      await sql.query(
        `UPDATE planora.sections SET active=false WHERE course_id=$1`,
        [courseId]
      );
      for (const [i, teacher] of c.instructors.entries()) {
        const groupId =
          oldGroups.find((g) => g.position === i)?.id || randomUUID();
        await sql.query(
          `INSERT INTO planora.instructor_groups(id,course_id,position,name,note,unassigned,active) VALUES($1,$2,$3,$4,$5,$6,true)
        ON CONFLICT(course_id,position) DO UPDATE SET name=EXCLUDED.name,note=EXCLUDED.note,unassigned=EXCLUDED.unassigned,active=true`,
          [
            groupId,
            courseId,
            i,
            teacher.name,
            teacher.note ?? null,
            teacher.unassigned ?? null,
          ]
        );
        for (const bucket of buckets)
          for (const [position, m] of teacher[bucket].entries()) {
            const identity = sectionKey(m);
            // First adoption of a verified source ID keeps the existing surrogate section UUID.
            const existing =
              oldSections.find((s) => s.identity_key === identity) ||
              (m.sourceId
                ? oldSections.find(
                    (s) =>
                      !s.source_id && s.kind === m.type && s.label === m.sec
                  )
                : undefined);
            const sectionId = existing?.id || randomUUID();
            await sql.query(
              `INSERT INTO planora.sections(id,course_id,instructor_group_id,identity_key,kind,label,source_id,position,active)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT(id) DO UPDATE SET instructor_group_id=EXCLUDED.instructor_group_id,
          identity_key=EXCLUDED.identity_key,kind=EXCLUDED.kind,label=EXCLUDED.label,source_id=EXCLUDED.source_id,position=EXCLUDED.position,active=true`,
              [
                sectionId,
                courseId,
                groupId,
                identity,
                m.type,
                m.sec,
                m.sourceId ?? null,
                position,
              ]
            );
            await sql.query(
              `DELETE FROM planora.meetings WHERE section_id=$1`,
              [sectionId]
            );
            await sql.query(
              `INSERT INTO planora.meetings(section_id,position,weekday,start_minute,end_minute,room) VALUES($1,0,$2,$3,$4,$5)`,
              [sectionId, m.day, m.start, m.end, m.room]
            );
          }
      }
      coursesByLegacy.set(c.id, {
        id: courseId,
        legacy_id: c.id,
        catalog_key: catalog,
        position: old?.position ?? pos,
      });
    }
  if (previous && canonical(previous.majors) === canonical(dataset.majors))
    return;
  // Explicit editorial mappings are normalized too. Removed offerings are filtered at staging time.
  await sql.query(`DELETE FROM planora.majors WHERE term_key=$1`, [term]);
  for (const [position, m] of dataset.majors.entries()) {
    await sql.query(
      `INSERT INTO planora.majors(term_key,id,position,title,subtitle,blurb) VALUES($1,$2,$3,$4,$5,$6)`,
      [term, m.id, position, m.title, m.subtitle, m.blurb]
    );
    for (const [i, y] of m.years.entries()) {
      await sql.query(
        `INSERT INTO planora.year_plans(term_key,major_id,id,position,label) VALUES($1,$2,$3,$4,$5)`,
        [term, m.id, y.id, i, y.label]
      );
      for (const [j, legacy] of y.courseIds.entries()) {
        if (!incomingIds.has(legacy))
          throw new SafeError('INVALID_COURSE_REFERENCE', 422);
        await sql.query(
          `INSERT INTO planora.year_plan_courses(term_key,major_id,year_id,course_id,position) VALUES($1,$2,$3,$4,$5)`,
          [term, m.id, y.id, coursesByLegacy.get(legacy)!.id, j]
        );
      }
    }
  }
}
export async function importCatalog(db: Database, input: unknown) {
  const { dataset, warnings } = normalizeDataset(input),
    hash = datasetHash(dataset),
    term = dataset.semester.key;
  return db.transaction(async (sql) => {
    // Lock a stable namespace before the first term row exists. Idempotent across processes.
    await sql.query(`SELECT pg_advisory_xact_lock(701426)`);
    const previous = (
      await sql.query(
        `SELECT * FROM planora.catalog_state WHERE term_key=$1 FOR UPDATE`,
        [term]
      )
    ).rows[0];
    if (previous) {
      const current = await readCatalog(sql, term);
      if (datasetHash(current.dataset) !== hash || current.hash !== hash)
        throw new SafeError('IMPORT_WOULD_OVERWRITE_EXISTING_CATALOG', 409);
      return {
        imported: false,
        revision: current.revision,
        ...counts(current.dataset),
        warnings,
      };
    }
    await writeCatalog(sql, dataset);
    const runId = randomUUID();
    await sql.query(
      `INSERT INTO planora.sync_runs(id,term_key,source,requested_by,status,started_at,finished_at,summary) VALUES($1,$2,'import','migration','completed',now(),now(),$3)`,
      [
        runId,
        term,
        JSON.stringify({
          ...counts(dataset),
          inserted: counts(dataset).courses + counts(dataset).sections,
          updated: 0,
          unchanged: 0,
          validationErrors: 0,
          skipped: 0,
        }),
      ]
    );
    await sql.query(
      `INSERT INTO planora.catalog_state(term_key,revision,content_hash) VALUES($1,1,$2)`,
      [term, hash]
    );
    await sql.query(
      `INSERT INTO planora.catalog_snapshots(term_key,revision,run_id,content_hash,dataset) VALUES($1,1,$2,$3,$4)`,
      [term, runId, hash, JSON.stringify(dataset)]
    );
    const roundtrip = await readCatalog(sql, term);
    if (datasetHash(roundtrip.dataset) !== hash)
      throw new SafeError('IMPORT_ROUNDTRIP_FAILED', 500);
    return {
      imported: true,
      revision: 1,
      ...counts(roundtrip.dataset),
      warnings,
    };
  });
}

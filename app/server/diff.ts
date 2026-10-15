import {
  canonical,
  catalogKeys,
  counts,
  sectionKey,
  sectionRows,
  type Course,
  type Dataset,
} from './catalog-model.js';

export type Change = {
  catalog: string | null;
  courseId: string | null;
  code: string | null;
  title: string | null;
  sectionKey: string | null;
  category:
    | 'course_added'
    | 'course_removed'
    | 'course_modified'
    | 'section_added'
    | 'section_removed'
    | 'section_modified'
    | 'metadata_modified';
  before: any;
  after: any;
  fields: string[];
};
const changedFields = (before: any, after: any): string[] =>
  [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter(
      (key) =>
        canonical(before?.[key] ?? null) !== canonical(after?.[key] ?? null)
    )
    .sort();
const info = ({ instructors, ...c }: Course) => ({
  ...c,
  // Notes and unassigned flags matter; array order and empty component arrays do not.
  instructorNotes: instructors
    .filter((i) => i.note)
    .map((i) => ({ name: i.name, note: i.note }))
    .sort((a, b) => canonical(a).localeCompare(canonical(b))),
});
export function diffCatalog(before: Dataset, after: Dataset) {
  const changes: Change[] = [];
  let inserted = 0,
    updated = 0,
    unchanged = 0,
    removed = 0;
  for (const catalog of catalogKeys) {
    const old = new Map(before[catalog].map((c) => [c.id, c])),
      next = new Map(after[catalog].map((c) => [c.id, c]));
    for (const id of [...new Set([...old.keys(), ...next.keys()])].sort()) {
      const a = old.get(id),
        b = next.get(id),
        course = b || a!;
      const common = {
        catalog,
        courseId: id,
        code: course.code,
        title: course.name,
      };
      const push = (
        category: Change['category'],
        previous: any,
        fresh: any,
        key: string | null = null
      ) =>
        changes.push({
          ...common,
          sectionKey: key,
          category,
          before: previous ?? null,
          after: fresh ?? null,
          fields: changedFields(previous, fresh),
        });
      if (!a) {
        inserted++;
        push('course_added', null, info(b!));
      } else if (!b) {
        removed++;
        push('course_removed', info(a), null);
      } else if (canonical(info(a)) !== canonical(info(b))) {
        updated++;
        push('course_modified', info(a), info(b));
      } else unchanged++;
      const freshRows = b ? sectionRows(b) : [];
      const oldSections = new Map(
        (a ? sectionRows(a) : []).map((m) => {
          const adopted = !m.sourceId
            ? freshRows.find(
                (n) => n.sourceId && n.type === m.type && n.sec === m.sec
              )
            : undefined;
          return [sectionKey(adopted || m), m];
        })
      );
      const newSections = new Map(freshRows.map((m) => [sectionKey(m), m]));
      for (const key of [
        ...new Set([...oldSections.keys(), ...newSections.keys()]),
      ].sort()) {
        const x = oldSections.get(key),
          y = newSections.get(key);
        if (!x) {
          inserted++;
          push('section_added', null, y, key);
        } else if (!y) {
          removed++;
          push('section_removed', x, null, key);
        } else if (canonical(x) !== canonical(y)) {
          updated++;
          push('section_modified', x, y, key);
        } else unchanged++;
      }
    }
  }
  for (const field of ['semester', 'majors'] as const)
    if (canonical(before[field]) !== canonical(after[field])) {
      updated++;
      changes.push({
        catalog: null,
        courseId: null,
        code: null,
        title: null,
        sectionKey: null,
        category: 'metadata_modified',
        before: before[field],
        after: after[field],
        fields: [field],
      });
    }
  return {
    changes,
    summary: {
      ...counts(after),
      inserted,
      updated,
      unchanged,
      removed,
      additions: changes.filter((c) => c.category.endsWith('_added')).length,
      removals: changes.filter((c) => c.category.endsWith('_removed')).length,
      modifications: changes.filter((c) => c.category.endsWith('_modified'))
        .length,
      validationErrors: 0,
      skipped: 0,
    },
  };
}

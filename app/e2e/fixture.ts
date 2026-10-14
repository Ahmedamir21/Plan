import type { Dataset } from '../server/catalog-model';
/** Entirely synthetic. Never import this into a deployed catalog or approve the real source contract. */
export function controlledCatalog(): Dataset {
  return {
    semester: {
      key: 'fixture-2026-main',
      institution: 'Controlled test institution',
      plannerName: 'Planora',
      term: 'Fall',
      year: 2026,
      session: 'Synthetic test only',
      version: 'fixture-v1',
      dataLastVerified: '2026-10-14',
      calendarStartDate: '2026-09-01',
      calendarEndDate: '2026-12-31',
      publicHostLabel: 'example.invalid',
    },
    courses: [
      {
        id: 'fixturea',
        sourceId: 'fixture-course-a',
        code: 'TEST 101',
        name: 'Controlled Fixture A',
        credits: 3,
        c: 1,
        instructors: [
          {
            name: 'Fixture Instructor A',
            lectures: [
              {
                sourceId: 'fixture-a-lecture-01',
                type: 'Lecture',
                sec: '01',
                day: 'Mon',
                start: 600,
                end: 660,
                room: 'Fixture A',
              },
            ],
            labs: [
              {
                sourceId: 'fixture-a-lab-01',
                type: 'Lab',
                sec: '01',
                day: 'Tue',
                start: 840,
                end: 900,
                room: 'Fixture Lab',
              },
            ],
            tutorials: [],
          },
        ],
      },
      {
        id: 'fixtureb',
        sourceId: 'fixture-course-b',
        code: 'TEST 102',
        name: 'Controlled Fixture B',
        credits: 3,
        c: 2,
        instructors: [
          {
            name: 'Fixture Instructor B',
            lectures: [
              {
                sourceId: 'fixture-b-lecture-01',
                type: 'Lecture',
                sec: '01',
                day: 'Mon',
                start: 720,
                end: 780,
                room: 'Fixture B',
              },
            ],
            labs: [],
            tutorials: [],
          },
        ],
      },
    ],
    sch: [
      {
        id: 'fixturesch',
        sourceId: 'fixture-course-sch',
        code: 'TEST SCH',
        name: 'Controlled SCH Fixture',
        credits: 2,
        c: 3,
        instructors: [
          {
            name: 'Fixture Instructor SCH',
            lectures: [
              {
                sourceId: 'fixture-sch-lecture-01',
                type: 'Lecture',
                sec: '01',
                day: 'Wed',
                start: 600,
                end: 660,
                room: 'Fixture SCH',
              },
            ],
            labs: [],
            tutorials: [],
          },
        ],
      },
    ],
    majors: [
      {
        id: 'it',
        title: 'Controlled Test Program',
        subtitle: 'Not university data',
        blurb: 'Synthetic acceptance fixture',
        years: [
          { id: 'y2', label: 'Year 2', courseIds: ['fixturea', 'fixtureb'] },
        ],
      },
    ],
  };
}
export function changedCatalog() {
  const dataset = controlledCatalog();
  dataset.courses[0].instructors[0].lectures[0].start = 750;
  dataset.courses[0].instructors[0].lectures[0].end = 810;
  dataset.courses[0].instructors[0].labs.push({
    sourceId: 'fixture-a-lab-02',
    type: 'Lab',
    sec: '02',
    day: 'Tue',
    start: 900,
    end: 960,
    room: 'Fixture New Lab',
  });
  return dataset;
}

import { useMemo } from 'react';
import { COURSE_BY_ID } from '../data/courses';
import { catalogFresh } from '../lib/catalogClient';
import { isPersistencePaused, preservedSchedule } from '../lib/appState';
import { scheduleImpacts, type SelectedSnapshot } from '../lib/scheduleImpact';
import type { PickState } from '../lib/picks';
export function ScheduleImpact({
  picks,
  snapshot,
}: {
  picks: PickState;
  snapshot?: SelectedSnapshot;
}) {
  const notices = useMemo(
    () => scheduleImpacts(picks, COURSE_BY_ID, snapshot, catalogFresh),
    [picks, snapshot]
  );
  const backup = preservedSchedule(),
    paused = isPersistencePaused();
  if (!notices.length && !paused) return null;
  const download = () => {
    if (!backup) return;
    const url = URL.createObjectURL(
      new Blob([backup], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'planora-preserved-local-schedule.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <aside
      className="panel mx-auto my-3 max-w-7xl p-4 no-print"
      aria-labelledby="schedule-impact-heading"
    >
      <h2
        id="schedule-impact-heading"
        className="font-bold"
        style={{ color: 'var(--warn)' }}
      >
        Review catalog updates for your saved plan
      </h2>
      <p className="mt-1 text-sm">
        These checks happen only on this device. Your saved choices have not
        been replaced, and no Self-Service registration was inspected or
        changed. Unresolved choices are not shown as current timetable meetings.
      </p>
      {paused && (
        <p className="mt-2 text-sm" role="alert">
          Device storage could not preserve a backup. Automatic saving is paused
          to protect the existing plan. Download the preserved copy, free
          storage space, then reload.
        </p>
      )}
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
        {notices.map((n) => (
          <li key={n.id}>{n.text}</li>
        ))}
      </ul>
      {backup && (
        <button className="btn mt-3 px-3 py-2 text-sm" onClick={download}>
          Download preserved local plan
        </button>
      )}
      <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
        Review the published section list and explicitly reselect a section if
        appropriate. A section-label match without a source ID is a potential
        issue, not proof of an enrollment change.
      </p>
    </aside>
  );
}

import { courseDataLastVerified } from '../data/meta';
import { CREATOR_CREDIT, PRODUCT_TITLE, SEMESTER_CONFIG, TERM_LABEL, TERM_SESSION_LABEL } from '../config/semester';

const GITHUB_REPO_URL = 'https://github.com/Ahmedamir21/Planora';

const STEPS = [
  'Pick your major — it decides which courses this planner shows you.',
  'Tick the courses you are registering, optionally filter the lists with an instructor pill, and choose lecture / lab / tutorial times. Conflicting options grey themselves out instantly, and un-picking restores them.',
  'Open ⚙ Schedule Preferences and set your goals (free days, minimal gaps, time windows, daily hour caps). Everything is soft by default; tick "require" only when a rule must never be broken.',
  'Press ✦ Generate Best Schedules — the engine searches every instructor and section, prunes conflicts, and returns your top ranked, conflict-free schedules.',
  'Compare up to three candidates side by side, then press "Use This Schedule" to make it your active selection.',
  'Review the timetable, dashboard, and details; Print / Save PDF a clean copy if you like.',
  'Share the exact plan with the Share Schedule link — it restores major, courses, sections, instructor filters and preferences in the recipient\'s browser.',
];

export function AboutPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto max-w-[860px] space-y-3">
      <button type="button" className="btn" onClick={onBack}>
        ‹ Back to planner
      </button>

      <section className="panel p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill" style={{ color: 'var(--accent)' }}>
            Version {SEMESTER_CONFIG.version}
          </span>
          <span className="pill">{TERM_SESSION_LABEL}</span>
        </div>
        <h1 className="mt-2 text-[21px] font-extrabold tracking-tight sm:text-[25px]">
          {PRODUCT_TITLE}
        </h1>

        <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          Planora is an independent student project for CSAI students. It is not an official Zewail City website
          or registration service. Confirm course details in Self-Service before registering.
        </p>

        <div className="mt-5 space-y-5">
          <div>
            <h2 className="text-[13.5px] font-bold tracking-tight">What is this?</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              Planora helps students build and organize their {TERM_LABEL} course schedules. Pick a
              major, tick the courses you're registering, and choose real lecture, lab and tutorial times — the
              planner checks for time conflicts exactly (a 2:00–2:59 session next to a 3:00–3:59 session is fine; two
              overlapping meetings never are), tracks credit hours and free time, and its Best Schedule search finds
              the strongest conflict-free combinations for your preferences before you register.
            </p>
          </div>

          <div>
            <h2 className="text-[13.5px] font-bold tracking-tight">How to use it</h2>
            <ol className="mt-1.5 space-y-1.5">
              {STEPS.map((step, i) => (
                <li key={step} className="flex items-start gap-2.5 text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                  <span
                    className="mono mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold"
                    style={{ background: 'var(--accent-soft, var(--surface))', color: 'var(--accent)', border: '1px solid var(--line)' }}
                  >
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="panel-soft p-3.5">
              <h2 className="text-[13.5px] font-bold tracking-tight">Preferences: soft vs hard</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                Goals like "minimize gaps" or "prefer Thursday free" only change the ranking order. Turning a rule
                into a requirement ("treat as a requirement") makes the generator reject schedules that break it — and
                if that leaves nothing, the app tells you clearly instead of ignoring the rule.
              </p>
            </div>
            <div className="panel-soft p-3.5">
              <h2 className="text-[13.5px] font-bold tracking-tight">Free Time & exact durations</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                Every duration is end − start with no padding: an 8:00–9:59 block plus buffer stores as exactly 120
                minutes and a one-hour tutorial as exactly 60. Free Time = the shared Sunday–Thursday 8:00 AM–6:00 PM
                window minus your real class minutes, counting double-booked time once.
              </p>
            </div>
          </div>

          <div>
            <h2 className="text-[13.5px] font-bold tracking-tight">Data</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              Course, section, instructor, room and time information reflects the {TERM_LABEL} course data used by this
              project. The dataset was last manually verified against Self-Service on {courseDataLastVerified()}.
              Sections with no confirmed instructor are shown exactly as published — nothing is invented.
              The dataset itself is never modified: hiding, filtering and conflict marking are all derived views that
              disappear the moment you change your selection. Always double-check final times on the official
              registration portal before registering.
            </p>
          </div>

          <div>
            <h2 className="text-[13.5px] font-bold tracking-tight">Your privacy</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              Everything stays in your browser. Your plan is saved in Local Storage on this device only, and Share
              links carry opaque course/section ids and your preference flags — never names, emails, or any personal
              information. The credit-limit note stores only the cap you picked (13, 18, or the 21-credit Over Load option) as an app
              setting on this device — no GPA or academic record is ever asked for, stored, or transmitted. Open a
              saved or shared URL on the same browser to restore exactly where you left off.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--line-soft)' }}>
            <div>
              <h2 className="text-[13.5px] font-bold tracking-tight">Version</h2>
              <p className="mt-1 text-[13px]" style={{ color: 'var(--muted)' }}>
                Version {SEMESTER_CONFIG.version} — merged build: advanced Best-Schedule engine, live credits dashboard, instructor
                filters, share links &amp; mobile upgrade. Built with React, Vite and Tailwind CSS.
              </p>
              <p className="mt-1 text-[13px]" style={{ color: 'var(--muted)' }}>
                <span style={{ color: 'var(--accent)' }}>{CREATOR_CREDIT}</span>
              </p>
            </div>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-accent"
              aria-label="Open this project's GitHub repository"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.57.1.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.7-1.28-1.7-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.44-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 015.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.73.8 1.17 1.83 1.17 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.21.66.8.55C20.21 21.39 23.5 17.08 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
              </svg>
              GitHub Repository
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

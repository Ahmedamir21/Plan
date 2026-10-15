<p align="center">
  <img src="assets/readme-banner.svg" width="100%" alt="Planora — Student Schedule Planner" />
</p>

<div align="center">

# Planora

**An independent, student-built schedule planning tool for Zewail City — designed to make course selection, conflict checking, schedule optimization, and sharing easier before registration.**

<br/>

<a href="https://zc-planora.vercel.app/">
  <img src="https://img.shields.io/badge/REFERENCE_SITE-Planora-668BCC?style=for-the-badge&labelColor=161A23" alt="Open historical reference site" />
</a>

<br/><br/>

<img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
<img src="https://img.shields.io/badge/TypeScript_5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5" />
<img src="https://img.shields.io/badge/Vite_7-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 7" />
<img src="https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" />
<img src="https://img.shields.io/badge/Gemini-Schedule_Assistant-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white" alt="Gemini Schedule Assistant" />
<img src="https://img.shields.io/badge/Vercel-Production-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />

<br/><br/>

**Information Technology (Years 2–4) · Cyber Security (Years 1–4, courses pending) · Data Science & AI · Software Engineering**  
**Years 1–4 · Shared Requirements · Cross-Year Planning**

</div>

---

> **Repository scope:** this upgrade changes **Ahmedamir21/Plan only**. Historical Planora site links are read-only references, not proof of this repository's current deployment. Production SQL cutover requires separate verified setup and explicit approval; live university sync and student email remain disabled by default.
>
> Start with the [pre-edit audit](docs/REPOSITORY_AUDIT.md), [SQL setup / safe rollback](docs/SQL_SETUP.md), [current acceptance evidence](docs/PR2_ACCEPTANCE.md), [sync safety contract](sync/README.md), and [security limits](docs/SECURITY.md).

## Table of Contents

| | |
|---|---|
| [Overview](#overview) | [Schedule Assistant](#schedule-assistant) |
| [Key Features](#key-features) | [Architecture](#architecture) |
| [How It Works](#how-it-works) | [Technology Stack](#technology-stack) |
| [Supported Study Plans](#supported-study-plans) | [Project Structure](#project-structure) |
| [Best Schedule Engine](#best-schedule-engine) | [Local Development](#local-development) |
| [Conflict & Validation Rules](#conflict--validation-rules) | [Deployment](#deployment) |
| [Sharing & Persistence](#sharing--persistence) | [Data Accuracy](#data-accuracy--limitations) |
| [Testing](#testing) | [Contributing](#contributing) |
| [Privacy](#privacy) | [Disclaimer](#disclaimer) |
| [Admin Workspace](#admin-workspace) | [Presentation](#presentation) |
| [Project Map](docs/PROJECT_MAP.md) | |

---

## Overview

**Planora** is a web-based planner built to help students explore their Fall 2026 options before final registration.

Instead of manually comparing lecture, lab, and tutorial times across multiple courses, the planner keeps everything in one place and continuously evaluates the schedule as the student makes changes.

It can:

- show course options by **major and academic year**;
- combine lecture, lab, and tutorial sections across published instructor groups;
- detect real timetable conflicts;
- track credits and campus days;
- show free time and schedule gaps;
- generate and compare conflict-free schedules;
- preserve user preferences;
- share a schedule through a link or image;
- and provide an AI-assisted schedule workflow grounded in the planner's own course data.

> **Historical reference site (deployment not verified):** https://zc-planora.vercel.app/

> **Independent student project:** Planora is not an official university service. Confirm all registration details in Self-Service.

> **Created by:** Ahmed Amir (IT Representative) and Youssef Taha (AI Representative).

> **Brand assets:** [Planora logo](Final_Fall_2026_ZewailCity/Templates-Final-Final-main/Zewail-City-Templates-arena-01a09711-zewail-city-templates/Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail/public/planora-logo.svg) · [App icon](Final_Fall_2026_ZewailCity/Templates-Final-Final-main/Zewail-City-Templates-arena-01a09711-zewail-city-templates/Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail/public/icons/planner-icon.svg)

> **Preserved fixture verification date:** **September 24, 2026**

> **Reporting an error:** Select **⚑ Report** beside a course or **Report an issue** in the footer. Choose the incorrect fields (name, instructor, time, room, section, credits, or other) and explain the problem. Reports go to the private admin inbox without a GitHub account; **Cancel** closes the form without sending anything. Admins review Self-Service separately and record whether a correction is needed. Reports are not official university tickets. Optional no-domain email alerts can be configured through Google Apps Script (see `docs/REPORT_EMAIL.md`); automatic Self-Service checks are not connected.

> **General feedback:** Use the visible **Feedback** button near the top of the planner. Enter a name or nickname if you want, rate the overall experience from 1–10, then optionally write your opinion or an improvement and choose a topic. A rating alone can be sent privately to the admins. The admin panel shows the name (or Anonymous), rating, comment, topic and status, and lets admins review entries. This is separate from reporting incorrect course data.

> **Release status:** These features describe this repository revision. A live deployment may still serve an older revision while Vercel builds; check the site itself for current availability.

---

## Key Features

<table>
<tr>
<td width="33%" valign="top">

### 🎓 Major & Year Planning
Choose your academic year first, then one of its available majors. Browse the Fall 2026 plan with support for Years 1–4.

</td>
<td width="33%" valign="top">

### 🔎 Course Search
Find courses quickly through the course search and the global command palette.

</td>
<td width="33%" valign="top">

### 🧩 Section Selection
Choose lecture, lab, and tutorial meetings independently from the published course data.

</td>
</tr>

<tr>
<td width="33%" valign="top">

### ⚠️ Conflict Detection
Time overlaps are evaluated using the actual start and end times of each meeting.

</td>
<td width="33%" valign="top">

### 👨‍🏫 Instructor Filtering
Filter visible options by instructor without locking the course to a single instructor group.

</td>
<td width="33%" valign="top">

### 🔄 Cross-Year Courses
Add courses from another year of the same major without losing the current study-plan context.

</td>
</tr>

<tr>
<td width="33%" valign="top">

### ✦ Best Schedule
Searches valid section combinations and ranks the strongest matches against the student's preferences.

</td>
<td width="33%" valign="top">

### ⚙️ Schedule Preferences
Prefer fewer campus days, smaller gaps, earlier finishes, later starts, free days, and time limits.

</td>
<td width="33%" valign="top">

### 🤖 Schedule Assistant
Ask questions in Arabic, English, Franco/Arabizi, or a mix — using the current planner as context.

</td>
</tr>

<tr>
<td width="33%" valign="top">

### ✅ Confirmable AI Changes
AI schedule changes are previewed and validated before the student can apply them.

</td>
<td width="33%" valign="top">

### 🔗 Shareable Schedules
Share planner state using a URL and export the current schedule as an image.

</td>
<td width="33%" valign="top">

### 📱 Responsive UI
Designed for both desktop and mobile use with large touch targets and responsive schedule views.

</td>
</tr>
</table>

---

## How It Works

```mermaid
flowchart LR
    A["Choose Year"] --> B["Choose Major"]
    B --> C["Select Courses"]
    C --> D["Pick Lecture / Lab / Tutorial"]
    D --> E["Live Conflict + Credit Validation"]
    E --> F["Tune Preferences"]
    F --> G["Generate / Compare Best Schedules"]
    G --> H["Use, Share or Export Schedule"]

    E --> AI["Schedule Assistant"]
    AI --> P["Preview Suggested Changes"]
    P --> V["Planner Validation"]
    V -->|"Valid + Confirmed"| H
    V -->|"Conflict / Invalid"| E
```

The planner deliberately keeps **manual control** in the student's hands. Automated tools can suggest or generate schedules, but the student decides which schedule is actually used.

---

## Supported Study Plans

The planner currently includes Fall 2026 planning support for:

| Major | Years | Focus |
|---|---:|---|
| **Information Technology** | 1–4 | Networks, Security & Governance |
| **Data Science & AI** | 1–4 | Data Science and Artificial Intelligence |
| **Software** | 1–4 | Software Engineering |

Shared requirement courses such as SCH electives remain available across majors and years where configured in the planner.

The cross-year browser also allows students to add courses from another academic year of their **current major**.

---

## Best Schedule Engine

The Best Schedule feature does more than shuffle visible sections.

It builds valid course-level combinations from the published meeting data, then searches across those combinations while rejecting schedules that break real time constraints.

### Ranking signals

Depending on the student's preferences, the engine can favor schedules with:

- fewer campus days;
- smaller gaps;
- earlier finishing times;
- later starting times;
- selected preferred days;
- requested free days;
- preferred time windows;
- maximum hours per day.

Preferences can act as **soft ranking signals** or, where supported by the UI, **hard requirements**.

The search uses a bounded execution budget so extremely large combination spaces cannot freeze the browser.

---

## Conflict & Validation Rules

The planner works with real intervals rather than rough time-block labels.

Two meetings conflict when:

```text
startA < endB && startB < endA
```

That means back-to-back sessions are valid.

For example:

```text
12:00 PM – 2:00 PM
2:00 PM  – 4:00 PM
```

do **not** overlap.

The validation layer is also reused by AI proposals. Before an AI-generated change can be applied, the planner checks that:

1. the course exists for the selected major;
2. the proposed meeting ID exists in the current published planner data;
3. the requested lecture/lab/tutorial type matches a real meeting;
4. the proposal does not create a timetable conflict;
5. the proposal does not exceed the active credit limit.

The AI does not bypass the planner engine.

---

## Schedule Assistant

The **Schedule Assistant** is a Gemini-powered helper integrated directly into the planner.

It receives structured planner context such as:

- selected major and year;
- selected courses;
- current lecture/lab/tutorial meetings;
- published alternative sections;
- instructors;
- rooms and times;
- current conflicts;
- credit totals;
- campus days;
- gap time;
- schedule preferences.

### Natural-language interaction

Students can ask questions such as:

```text
Reduce my gaps
```

```text
خليني أروح 3 أيام بس
```

```text
مش عايز 8 الصبح
```

```text
Can I finish earlier without changing MATH 105?
```

The assistant supports **Arabic, English, Franco/Arabizi, and mixed-language conversations**.

### AI action flow

```mermaid
sequenceDiagram
    participant U as Student
    participant AI as Schedule Assistant
    participant UI as Planner UI
    participant V as Validation Engine

    U->>AI: Natural-language request
    AI->>UI: Structured proposal
    UI->>V: Validate courses, meetings, credits and conflicts
    V-->>UI: Before / After metrics
    UI-->>U: Preview + Apply / Cancel
    U->>UI: Apply changes
    UI->>V: Revalidate
    V-->>UI: Valid
    UI-->>U: Updated schedule + Undo
```

The assistant **cannot silently change the planner**. A schedule mutation requires an explicit student confirmation.

### Quick prompts

The current assistant includes shortcuts such as:

- **Reduce gaps**
- **Fewer campus days**
- **Finish earlier**
- **Avoid 8 AM**
- **Suggest another course**

### Security boundary

The Gemini API key is used only by the server-side Vercel function and is never included in the frontend bundle.

---

## Credit Planning

The planner supports the configured credit-cap choices:

- **13 credits**
- **18 credits**
- **21 credits / Over Load**

The general site ceiling is **21 credits**.

The UI also provides lightweight, non-blocking milestone reminders at **13, 17, 18, and 21 credits**. These are informational toasts only — they do not interrupt navigation or require dismissal before the student can continue using the planner.

No GPA value is requested or stored.

---

## Sharing & Persistence

The application keeps planner state locally and supports shareable schedule links.

A shared planner state can include information such as:

- major;
- academic year;
- selected courses;
- section picks;
- instructor filters;
- schedule preferences;
- display filters.

A shared URL opens an explicit preview and does not overwrite the existing saved plan or locks until the user chooses to save it. New v6 links retain exact meeting facts; older positional links show a section-verification caution. Catalog updates preserve well-formed old meeting keys, keep a raw local backup, and warn about affected selected sections/new overlaps without changing a university registration.

The planner also supports schedule-image export for easier sharing outside the app.

---

## Architecture

```mermaid
flowchart LR
    SQL["Normalized PostgreSQL"] --> DAL["Server-only SQL DAL / API"]
    DAL --> UI["Existing React planner"]
    UI --> LOCAL["Local choices, deterministic engine, sharing and impact warnings"]
    ADMIN["Existing authenticated admin"] --> JOB["Queued SQL lease + fixed Plan workflow"]
    JOB --> READER["Approved academic-only GET reader — disabled pending verification"]
    READER --> REVIEW["Staged diff / explicit admin review"]
    REVIEW --> SQL
    SQL --> HISTORY["Committed public academic history"]
    SQL --> OUTBOX["Optional consent-based email outbox — disabled by default"]
    UI --> AI["Optional existing server-side schedule assistant"]
```

PostgreSQL is the only live academic source. The original JSON files are preserved import/test fixtures, not bundled runtime data. Redis retains nonacademic reports, feedback, login limits and legacy security/history. No browser database credentials, no silent JSON fallback, and no personal schedule upload to the source agent. The AI assistant's existing opt-in context flow is separate. SQL publication, snapshot, audit and notification outbox commit atomically after review.

The deterministic scheduler, UI design, nested directories and Vercel `app/` wrapper remain. See [architecture and operator checklist](docs/SQL_SETUP.md).

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 |
| Language | TypeScript 5 |
| Build Tool | Vite 7 |
| Styling | Tailwind CSS 4 + custom CSS variables |
| Schedule Logic | Client-side TypeScript |
| AI | Google Gemini |
| AI API | Vercel Serverless Function |
| Deployment | Vercel |
| Academic Data | Server-only PostgreSQL / node-postgres |
| State Persistence | Browser Local Storage; local pre-update backups |
| Private Operational Storage | Existing Redis reports/feedback/login limits |
| Testing | Custom engine harness + SSR smoke tests + jsdom UI tests |

---

## Project Structure

The Vercel project uses `app/` as its root. The planner package remains in its original nested directory so its build paths and deployment settings continue to work.

```text
Plan/
├── .github/workflows/planner-ci.yml
├── README.md
├── assets/
│   ├── readme-banner.svg
│   └── Planora_Overview_2026.pptx
├── app/
│   ├── api/
│   │   ├── admin.ts
│   │   ├── assistant.ts
│   │   ├── feedback.ts
│   │   └── reports.ts
│   ├── admin-accounts.ts
│   ├── dataset-validation.cjs
│   ├── package.json
│   └── vercel.json
├── docs/
│   ├── ADMIN_PANEL.md
│   ├── REPORT_EMAIL.md
│   └── SEMESTER_ROLLOVER.md
├── scripts/
│   ├── hash-admin-password.mjs
│   └── planora-report-mailer.gs
└── Final_Fall_2026_ZewailCity/
    └── Templates-Final-Final-main/
        └── Zewail-City-Templates-arena-01a09711-zewail-city-templates/
            └── Final_Fall_2026_ZewailCity/
                └── Final_Fall_2026_Zewail/
                    ├── src/
                    │   ├── components/
                    │   ├── data/
                    │   ├── lib/
                    │   ├── semester/       # Preserved migration/test fixtures
                    │   ├── utils/
                    │   ├── App.tsx
                    │   ├── index.css
                    │   └── types.ts
                    ├── semester-template/  # Blank dataset template
                    ├── scripts/            # Data and PWA build checks
                    ├── tests/
                    ├── package.json
                    └── vite.config.ts
```

> The nested source layout is a legacy repository structure. The production Vercel wrapper under `app/` exists to keep the deployed serverless API path short and reliable.

For each remaining directory and file group, see the [project map](docs/PROJECT_MAP.md).

---

## Local Development

Use Node **22** and locked dependencies. Clone only the target repository:

```bash
git clone https://github.com/Ahmedamir21/Plan.git
cd Plan
P='Final_Fall_2026_ZewailCity/Templates-Final-Final-main/Zewail-City-Templates-arena-01a09711-zewail-city-templates/Final_Fall_2026_ZewailCity/Final_Fall_2026_Zewail'
npm --prefix app ci
npm --prefix sync ci
npm --prefix "$P" ci
npm --prefix app run dev:seed
PLANORA_LOCAL_DB=true npm --prefix app run dev
# In a second terminal, with P set as above:
npm --prefix "$P" run dev
```

This uses isolated local PostgreSQL WASM fixtures and a same-origin API proxy. It does not start a university job, send email or provide default admin credentials. A production build is `npm --prefix app run build`; generated files are ignored. See [full local/setup instructions](docs/SQL_SETUP.md).

## Testing

```bash
npm --prefix app run typecheck
npm --prefix app test
npm --prefix sync run check
npm --prefix sync test
npm --prefix "$P" run typecheck
npm --prefix "$P" run build
npm --prefix app run test:e2e
for suite in test:platform test:data test:assistant test:admin test:completeness test:admin-ui test:import test:patch test:patch-ui test:english test:english-import test:audit test:ssr test:ui test:harness test:catalog test:sync-ui test:notifications-ui test:production-ui; do npm --prefix "$P" run "$suite" || exit 1; done
```

Original engine/data/UI/import/admin regressions remain. New tests exercise SQL roundtrip/roles/publication rollback, source pagination/failure safety, local saved-key preservation/conflicts, sync UI, double opt-in/outbox/retry/privacy and the actual built student JavaScript. CI adds a disposable PostgreSQL 16 service; local tests default to isolated PGlite. Never point tests at production. Production audits are blocking; the known unpatched dev-only tooling chain is documented in [security notes](docs/SECURITY.md).

## Deployment

Vercel root remains **`app`** with both student and admin builds. Keep the existing project's outside-root build support for the unchanged nested planner. **Confirm the actual project belongs to Ahmedamir21/Plan**; do not assume the historical reference site or a similarly named Planora project is the target.

Production requires the normalized schema, validated reviewed import (including any newer legacy Redis live overrides), restricted runtime DB login, verified TLS, private admin/Redis configuration and a preview review. The build is blocked without `PLANORA_SQL_CUTOVER_APPROVED=true` and core configuration. It never migrates/seeds/enables a worker or sends email automatically. The optional assistant continues to require its private `GEMINI_API_KEY`.

The owner-authorized [Plan-only Preview setup runner](docs/PREVIEW_SETUP.md) can provision the isolated SQL schema and verify the actual deployment once private access is configured. No successful cloud deployment is claimed without its evidence.

Follow [SQL cutover and rollback](docs/SQL_SETUP.md), [admin workflow](docs/ADMIN_PANEL.md), [source-worker contract](sync/README.md) and [optional email](docs/NOTIFICATIONS.md). Database provisioning, real source access, real email and deployment are not claimed by a successful fixture build/test.

---

## Data Accuracy & Limitations

The initial SQL import preserves the manually compiled Fall 2026 fixture dataset. Subsequent reviewed SQL publications supply live academic corrections.

It never changes university registration. A contract-gated, read-only catalog worker is implemented, but no authorized live university endpoint/login was verified; the shipped contract blocks real synchronization. A completed unchanged check is not invented when the source cannot be verified.

Therefore:

- instructor assignments can change;
- rooms can change;
- section times can change;
- courses can be added or removed;
- university registration rules can change independently of this project.

The repository records the current dataset verification date as:

> **2026-09-24**

The Best Schedule engine also uses a bounded search budget. In extremely large search spaces, it may return the strongest schedules found within that budget instead of exhaustively evaluating every theoretical combination.

**Always verify the final schedule in Zewail City Self-Service before registration.**

---

## Privacy

The application is intentionally lightweight.

The planner stores schedule-related state in the browser to restore the student's plan.

It does **not** ask for or intentionally store:

- student ID;
- university password;
- GPA value;
- Self-Service credentials.

Schedule Assistant requests include planner context required to answer the student's scheduling question. API credentials remain server-side. Optional academic email stores only an explicitly supplied address, consent and separately chosen course interests, requires verification, and supports unsubscribe. It is disabled by default. Local impact checks never send the saved plan to the sync agent.

---

## Contributing

Contributions that improve schedule accuracy, reliability, accessibility, mobile usability, or scheduling logic are welcome.

Before submitting a significant change:

1. keep course-data updates separate from unrelated UI changes where possible;
2. do not invent missing rooms, instructors, sections, or meeting times;
3. preserve the existing real-interval conflict rules;
4. run the relevant tests;
5. verify the production build.

For course-data corrections, include the source used to verify the updated section information in the pull request or commit context.

---


## Admin workspace

The existing `/admin.html` page retains its two server-verified accounts, course editor, private imports/previews, reports/feedback and review flow. Academic drafts, publication history and snapshots now use SQL; nonacademic Redis history/inboxes remain. Its sync panel adds a protected queued worker, complete run states/history, diff/removal review, snapshot recovery and optional outbox status. There is no public role toggle or default password.

Use [admin setup](docs/ADMIN_PANEL.md) and [semester rollover](docs/SEMESTER_ROLLOVER.md). Editing the preserved JSON fixtures no longer publishes academic data. The SQL cutover, real source connector and live mail must each be verified and authorized separately.

## Presentation

[Download the Planora overview](assets/Planora_Overview_2026.pptx). The deck uses the same dark blue brand style and covers the planner, semester data, reports, feedback and the private admin review workflow. It contains no login credentials.

## Disclaimer

This is an **independent student-built project** created to help Zewail City students plan their Fall 2026 schedules.

It is **not an official Zewail City registration system**, is not operated by the university registration office, and cannot register courses or reserve seats.

Official registration decisions and final section details should always be confirmed through **Zewail City Self-Service**.

---

<div align="center">

### Ready to build your schedule?

<a href="https://zc-planora.vercel.app/">
  <img src="https://img.shields.io/badge/Open_Planora-E8A957?style=for-the-badge&labelColor=161A23" alt="Open Planora" />
</a>

<br/><br/>

<sub>Fall 2026 · Built for planning, not registration.</sub>

</div>

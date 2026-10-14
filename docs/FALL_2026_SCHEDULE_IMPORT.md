# Fall 2026 / Main Session: time and room updates

The admin panel has a separate **Update times and rooms only** preview under **Data drafts**. It reads the latest *saved* private drafts for both `courses.json` and `sch.json`, then matches each CSV record to exactly one existing course, component and section. It never creates a course, instructor, or section, and never changes credits, names, majors, or section identifiers. A preview does not save or publish anything.

## CSV contract

UTF-8 (optionally with BOM), with exactly these seven columns, in this order:

```csv
courseCode,subtype,section,day,start,end,room
CSAI 205,Lecture,03,Tue,10:00,12:00,G006-B
```

Use the published `courseCode` and keep the exact section text (`01` is distinct from `1`). Component must be `Lecture`, `Lab` or `Tutorial`; day must be `Sun`–`Thu` or its full English name. Times use 24-hour `HH:mm` (12-hour `h:mm AM/PM` also parses) and are **exact minutes from midnight**. The schedule engine stores `[start, end)` intervals: `10:00,12:00` means 10:00 through the instant before 12:00. It does not round or add one minute. A displayed end like `11:59 AM` is **not** automatically interpreted as `12:00`; the row is excluded until the Self-Service representation is verified. Original CSV start/end strings appear beside each previewed change.

A blank room means the extraction missed it: the row is excluded, keeping the existing room and time. Only use the exact marker `ROOM_UNPUBLISHED` when Self-Service **explicitly confirms** that no room is published; this clears an existing room after review. Quote CSV fields that contain commas, including room text.

This mode accepts at most **250,000 characters per CSV**, matching the existing admin importer and draft API limit. It rejects a larger CSV in full. Split large exports at row boundaries and repeat the header in each batch. Compare batch and export totals before saving; splitting must not conceal failed pages or missing section details.

## Review and save

1. Sign in to the Planora admin panel and open **Data drafts**. Save or discard any unsaved edits already present in the JSON editor.
2. Upload or paste the verified CSV into **Update times and rooms only** and click **Preview times and rooms against both drafts**.
3. Review `Read`, `Applied`, `Unchanged`, `Excluded`, each excluded row with its reason, and every before/after change. Identical repeated rows are counted and ignored; different nonoverlapping meetings for one section and conflicting entries are all excluded. A section matching more than one instructor is also excluded. The current planner models one meeting per component selection, so multi-meeting sections need a separately reviewed model change.
4. Enter the Self-Service source/reason and save each affected draft (`courses.json` and/or `sch.json`) using the separate buttons. Each save has its own revision check, history entry and Undo. If one save fails, the other may already be saved: review both statuses and re-preview against the current drafts before retrying. **No student-facing data is automatically published.** Stage the saved drafts in the SQL sync/review panel and explicitly approve the full diff/removals. No source commit or fixture overwrite is needed for an academic publication.

The older **Import published sections** mode uses eight CSV columns including `instructor` and can add missing sections; use the new mode for time and room updates. It now distinguishes identical repeats from different entries but still holds multi-meeting sections for review.

## Source access and English course data still needed

The unsafe legacy browser scraper is retired. No authorized live university catalog API or safe interactive account flow has been verified. The new dedicated academic-only JSON reader is contract-gated and disabled; see [sync/README.md](../sync/README.md). Do not request/share personal schedules, cookies, Authorization headers, credentials, token-bearing URLs or unredacted Network dumps. Only an independently authorized, redacted academic endpoint/export contract can support a reviewed adapter. Never interact with registration controls to gather examples.

The four English codes `ENGL 003`, `ENGL 004`, `ENGL 156`, `ENGL 157` exist as code-only, optional shells in `courses.json` across every major/year, including Cyber Security. They have **no course title beyond their code, credits, instructor, sections, meeting times or rooms**. A selected shell has no timetable block and its unknown credits are excluded from the numeric credit tally with a warning. No levels are selected by default; their IDs are stable and never duplicated per major/year.

When official details are ready, use **Complete English levels from verified CSV** in the admin panel, not the seven-column time/room importer: `courseCode,courseName,credits,subtype,section,day,start,end,room,instructor`. `credits` means the *total course credits*, repeated on each section row (not the lab's zero-credit field). Supply an explicit official title, instructor and exact meeting boundary for every row. The preview holds conflicting entries, ambiguous `:59` end times and partial groups for review. Save the proposed `courses.json` representation as a private SQL draft with its verified source, check it, then stage/review/publish through the protected SQL workflow. Do not overwrite preserved migration fixtures. No CSV upload directly changes the public schedule. Preserve leading zeroes in codes and section numbers. The older eight-column importer deliberately refuses incomplete English shells because it lacks title and credits.

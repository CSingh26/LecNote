---
version: 1
slug: "web-src-app-tsx"
primary_target: "web/src/App.tsx"
related_targets: ["web/src/styles.css","web/src/pages/Library.tsx","web/src/pages/Lecture.tsx","web/src/pages/Courses.tsx","web/src/pages/Record.tsx","web/src/pages/Jobs.tsx","web/src/pages/Search.tsx","web/src/pages/Settings.tsx"]
---

# LecNote Workspace

Mode: Operate. Scope: all existing app screens and shared controls. Keep lecture
capture, transcript correction, preparation, merge, generation, export, review,
jobs, and settings behavior. PRODUCT.md owns the product constraints.

## Direction contract

THESIS: A student's own course edition, with lectures and sources on one working
sheet, replaces the crowded control stack and disconnected materials workflow.

OWN-WORLD: Solar-yellow course edge, white study sheet, dark ink, cherry recording
action, mineral-blue source cues. Clean condensed headings, readable body type,
typed metadata, square selection controls, and fine continuous rules.

STORY: Pick a course, scan lectures, find source files, then open the lecture to
study. Secondary commands stay available through contextual controls.

FIRST VIEWPORT: A compact top navigation and recording action; a yellow course
index at left; the lecture index occupies roughly two-thirds of the remaining
sheet, with an unframed materials tray at right. Page headings cap at 32px.

FORM: Course Editions, the user-selected copy-shop publication challenger to
grounded candidate 7, Collection Browser. Seed 387ada07. User approved the
original side-by-side composition after comparing three layouts.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Approved Reference

Approved comp: `.impeccable/mocks/course-editions-original.png`.
Approval record: `.impeccable/research/composition-choice.json`.
The comparison explicitly approved smaller practical headings and real library
data. File sizes and extra preview prose in the generated image are not product
facts. Demo fixtures live only in tests. Core UI stays semantic, not rasterized.

## Interaction and Layout

- Main destinations: Library, Courses, Materials, Search. Jobs and Settings stay
  quieter utility destinations; Record lecture is the persistent primary action.
- A course link preserves course identity and selection. All courses is explicit;
  a long course list must scroll rather than silently disappear after eight.
- An Add lecture menu contains recording upload and transcript import. Merge
  remains a contextual library command with its existing ordered dialog.
- The library material tray shows only its selected course's resources, with
  source preview and a direct way to manage/upload. No unbounded per-course
  network fan-out when viewing the whole library.
- A dedicated Materials destination gives course filtering, search, source
  preview, and access to existing resource management. Lecture attachments stay
  explicitly distinguished from reusable course resources.
- Lecture reading gets the main column; preparation, metadata, and processing
  settings move to a compact secondary region without dropping dirty-state,
  preparation-readiness, busy, or explicit-generation checks.
- Motion: 160ms course-selection marker changes, 180ms material-preview and
  dialog reveals, and short content transitions. Content is visible by default,
  stable in size, and immediate with reduced motion.
- At narrow widths the course index becomes a labeled drawer and materials an
  accessible disclosure. Reading remains full-width; no overlapping fixed panels.

## Verification

Use isolated ports and synthetic test data. Verify long names, empty courses,
failed requests, keyboard navigation, reduced motion, course switching, active
recording across navigation, and unsaved edits. No backend inference changes or
paid generation are required. Two batched visual rounds maximum, followed by the
independent Impeccable finish review and documentation.

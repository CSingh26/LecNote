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

STORY: Pick a course and lecture, then study its open notes alongside source
materials without losing the lecture index. Secondary commands stay contextual.

FIRST VIEWPORT: Compact top navigation and recording action; a yellow course
rail at left; a compact lecture index next; the selected lecture's title, player,
and view tabs above an open reading sheet with notes and course materials beside
each other. Page headings cap at 32px. Closing the reader restores the index.

FORM: Course Editions, the user-selected copy-shop publication challenger to
grounded candidate 7, Collection Browser. Seed 387ada07. User approved the third
composition, Reading workspace, in chat, superseding the initial first selection.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Approved Reference

Approved comp: `.impeccable/mocks/course-editions-reader.png`.
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
- Selecting a lecture opens its reading workspace while retaining the lecture
  index and its selection. URLs remain linkable; back/close restores the course
  index. Switching or closing honors the existing unsaved-edits confirmation.
- The open reader's material tray shows only that lecture's course resources,
  with source preview and a direct way to manage/upload. No unbounded per-course
  network fan-out when viewing the whole library. Never fabricate an open lecture
  when the library is empty or nothing is selected.
- A dedicated Materials destination gives course filtering, search, source
  preview, and access to existing resource management. Lecture attachments stay
  explicitly distinguished from reusable course resources.
- Lecture reading and source materials share the main sheet beside the retained
  lecture index. Preparation and processing settings stay in contextual controls,
  not a fifth permanent column. Preserve all dirty-state, preparation-readiness,
  busy, and explicit-generation checks.
- Motion: 160ms course-selection marker changes, 180ms material-preview and
  dialog reveals, and short content transitions. Content is visible by default,
  stable in size, and immediate with reduced motion.
- At narrow widths the course index becomes a labeled drawer, the lecture index
  becomes a browse view with an explicit return from reading, and materials an
  accessible disclosure. Reading stays full-width without overlapping panels.

## Verification

Use isolated ports and synthetic test data. Verify long names, empty courses,
failed requests, keyboard navigation, reduced motion, course switching, active
recording across navigation, and unsaved edits. No backend inference changes or
paid generation are required. Two batched visual rounds maximum, followed by the
independent Impeccable finish review and documentation.

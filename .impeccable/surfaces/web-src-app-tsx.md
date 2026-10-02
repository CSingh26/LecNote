---
version: 1
slug: "web-src-app-tsx"
primary_target: "web/src/App.tsx"
related_targets: ["web/src/styles.css","web/src/components/FieldGuideMark.tsx","web/src/components/ThemeControl.tsx","web/src/lib/theme.ts","web/src/components/Markdown.tsx","web/src/pages/Library.tsx","web/src/pages/Lecture.tsx","web/src/pages/Courses.tsx","web/src/pages/Record.tsx","web/src/pages/Jobs.tsx","web/src/pages/Search.tsx","web/src/pages/Settings.tsx"]
---

# LecNote Workspace: Academic Field Guide

Mode: Operate. Scope: all existing app screens and shared controls. Preserve
lecture capture, transcript correction, preparation, merge, generation, export,
review, jobs, settings, and recovery behavior. PRODUCT.md owns product constraints.

Status: unreleased milestone on `codex/academic-field-guide`, pending integration.
Implementation is present; regression verification and visual review are in
progress. No new release or deployment is implied.

## Direction contract

THESIS: A calm, approachable study journal keeps lectures, notes, and sources
close at hand, with enough space and hierarchy to support sustained reading.

OWN-WORLD: Warm paper, dark ink, honey primary actions, and sage selection.
Expressive Newsreader serif headings pair with clean system sans-serif labels.
A small geometric bee adds identity. Simple rows, restrained borders and shadows,
accessibility, honest feedback, and light/dark themes shape every screen.

STORY: Pick a course and lecture, then study the open notes with source materials
nearby. Contextual commands stay available without crowding the reading surface.
Capture, transcription, and paid note generation keep their distinct explicit
steps and truthful status feedback.

FIRST VIEWPORT: A 76px top navigation bar with the bee wordmark and honey recording
action; a 212px paper-green course rail; a compact lecture index when reading;
and the selected lecture's title, player, and tabs above notes and course
materials. Page headings are 32px on desktop and 26px on phones. Closing the
reader restores the lecture's course library and honors unsaved edits.

FORM: Academic Field Guide is the current user-directed philosophy. It
supersedes Course Editions as the visual authority while preserving the useful
reading workspace and existing workflows.

FINISH: Review the implemented interface in both themes, document tokens and
limitations, and keep review evidence separate from user library data. Do not
claim a completed verification or release until the corresponding work is done.

## Current reference and assets

`DESIGN.md`, `.impeccable/design.json`, and `web/src/styles.css` record the current
direction and implementation. The Course Editions comp
(`.impeccable/mocks/course-editions-reader.png`) and its earlier approval record
are historical references for v1.1.0, not the current approval basis.

Newsreader is bundled at `web/src/assets/fonts/Newsreader-variable.ttf` with
its SIL Open Font License. The bee is rendered by `FieldGuideMark.tsx`; the
favicon is `web/src/assets/bee.svg`. Vite emits local assets under `/assets/`
for the Python backend; no runtime font CDN is required. Core UI stays semantic.

Current selected screenshots belong in `.impeccable/review/field-guide/` and
use synthetic fixtures from `web/tests/fixtures/demo-library.ts`. Older images
directly under `.impeccable/review/` depict the previous design. Mockup prose,
file sizes, or invented lectures must never become product facts or real data.

## Interaction and layout

- Main destinations: Library, Courses, Materials, Search. Jobs and Settings are
  quieter utilities; Record lecture is always available in the header.
- Course selection preserves context. All courses is explicit, and a long list
  scrolls. Course names and selected states remain readable in both themes.
- Add lecture contains recording upload and transcript import. Merge stays a
  contextual library command with its existing ordered dialog.
- Simple library rows expose title, course, status, duration, and date. Use
  fine rules and a soft sage selected ground rather than repeated raised cards.
- Selecting a lecture retains the compact index and its selection. URLs remain
  linkable; switching or closing respects existing unsaved-edit confirmation.
- The reader shows only its lecture's course resources, with safe previews and
  management access. Notes and materials share the sheet; preparation and
  processing stay contextual. Do not fabricate a lecture for an empty library.
- Materials has explicit course filtering, local search, preview, and existing
  resource management. Keep lecture attachments distinct from reusable course
  resources. The all-course state must not fetch every course's material list.
- Color theme is a labeled native select above the rail's connection status.
  System is the default; Light and Dark persist through `lecnote-theme`. Apply
  the initial preference before React renders, follow live system changes, and
  permit session choices when storage is blocked. Theme changes also update
  lecture diagrams, plots, and recording waveforms.
- Loading, failure, empty, unsaved, and recovery states describe real conditions.
  Preserve preparation readiness, busy states, explicit capture consent, and
  the explicit action required for paid note generation.
- Motion uses 160ms selection markers and 180ms reveals with the shared easing.
  Content remains readable without animation; reduced motion removes it.
- At 1180px and below, materials move below notes behind an accessible disclosure.
  At 1100px and below, the reader expands and exposes a Lectures return link. At 900px
  and below, the course rail becomes a labeled drawer and the header uses two
  rows; theme selection remains accessible in the drawer. Phone layouts favor
  titles and status while retaining all workflows through their dedicated views.

## Verification scope

Use isolated ports and synthetic test data. The browser suite starts its own
strict-port Vite server at 4175; do not reuse an active recording server. Check
both themes, system preference changes, unavailable storage, long names, empty
courses, failed requests, keyboard navigation, reduced motion, course switching,
active capture across navigation, and unsaved edits. Verify diagrams, plots, and
waveforms remain readable when themes change. No backend inference changes or
paid generation are required. Record review results separately from this
contract. The milestone passes 132 frontend unit tests, 39 browser checks, and
the production build. Independent visual review approved the eight library/reader
captures. Active recording additionally fits at 320px with an accessible compact
bee wordmark and visible timer.

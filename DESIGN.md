# LecNote design: Course Editions

The shipped interface follows the approved **Course Editions** direction in its
**Reading workspace** layout (`.impeccable/mocks/course-editions-reader.png`).
A student's course edition keeps lectures and sources on one working sheet.
Tokens live in `web/src/styles.css` `:root` and are mirrored in
`.impeccable/design.json`.

## Identity

| Role | Token | Value |
| --- | --- | --- |
| Course navigation edge | `--solar` | `#f1de54` |
| Selected course / lecture ground | `--solar-pale` | `#fcf4c6` |
| Study sheet | `--surface` / `--bg` | `#ffffff` / `#fcfbf7` |
| Ink, rules, primary actions | `--ink` | `#22221f` |
| Recording action, active view marker | `--cherry` | `#c8434b` |
| Source cues, focus ring | `--mineral` | `#476e9b` |

- Headings use a system condensed stack (`--font-display`, Avenir Next
  Condensed → Roboto Condensed → Arial Narrow) so the app stays fully local.
  Page headings are 32px (26px on phones); letter spacing is always 0.
- Typed metadata (rail heading, library code, lecture counts, header timer)
  uses the mono stack. Body text is 15px; notes and previews read at 15–16px.
- Corners are at most 8px. Surfaces are flat and separated by fine rules;
  a 1px ink rule marks structural edges (header, index, list tops).

## Structure

- **Header (64px):** LecNote on the yellow brand cell, main destinations
  (Library, Courses, Materials, Search) with a cherry underline for the current
  page, the cherry **Record lecture** action (shows Recording/Paused and elapsed
  time while capturing), and quieter Jobs and Settings utilities.
- **Course rail (200px, yellow):** “My courses”, explicit **All courses**, then
  every course (scrolls; never truncated), each with its colour marker. The rail
  follows the current destination: on Materials it links to course materials,
  elsewhere to the course library. Manage courses and local status sit below.
- **Library:** course heading, **Add lecture** menu (Upload recording, Import
  transcript), search/course/status filters, lecture count with contextual
  **Merge recordings**, and ruled rows: Title · Course · Status · Duration · Date.
- **Reading workspace (`#/lecture/<id>`):** a compact lecture index (same
  filters, selected row in pale yellow with an ink marker) beside the reader:
  title, meta and course assignment, edit/export/delete/close, player, a
  contextual *Preparation and processing* band, then view tabs (Notes,
  Transcript, Materials, Review, Relevance). Notes sit beside the lecture's
  course materials; the Materials tab separates lecture attachments from
  reusable course materials. Closing returns to that course's library.
- **Materials (`#/materials?course=<id>`):** explicit course selector; the
  all-course state lists course destinations and fetches nothing per course.
  Selecting a file shows a safe text/Markdown preview and **Open original**;
  **Manage** opens the existing resource dialog.

## Motion

- 160ms (`--dur-marker`): course, tab, row, and navigation markers.
- 180ms (`--dur-reveal`): menus, material previews, dialogs, drawer, reader and
  tab-panel entry. All use `--ease`; content is visible by default.
- `prefers-reduced-motion: reduce` removes every animation and transition.

## Responsive behaviour

- ≤1320px: utility labels become icon-only (labels stay accessible).
- ≤1180px: course materials move below the notes behind an accessible
  Show/Hide disclosure.
- ≤1100px: the lecture index hides; the reader is full width with an explicit
  **Lectures** return link.
- ≤900px: the header becomes two rows and the course rail becomes a labelled
  drawer (focus moves in; Escape closes and restores focus).
- Verified without horizontal overflow at 320, 390, 1280, and 1440px.

## Provenance

All review screenshots in `.impeccable/review/` were captured by Playwright
from the synthetic fixtures in `web/tests/fixtures/demo-library.ts`. They are
not user data. The generated comp's file sizes and preview prose were not
reproduced as product facts.

# LecNote design: Academic Field Guide

Academic Field Guide makes LecNote a calm, approachable study journal. Warm
paper and dark ink carry the reading experience; honey marks primary actions,
sage marks selection and supporting cues. Expressive serif headings pair with
clean sans-serif labels. A small bee adds personality without competing with
lecture content. Simple rows, generous reading space, restrained borders and
shadows, accessibility, honest feedback, and light/dark themes guide the design.

This milestone is **integrated on `main` and unreleased**, with no new version
tag or published container image. The historical v1.1.0 release uses Course
Editions. Its approved comp and earlier review screenshots are historical
evidence, not the current design authority. The current implementation lives in
`web/src/styles.css`; `.impeccable/design.json` records its tokens and layout values.

## Palette and themes

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Page paper | `--bg` | `#f8f7ef` | `#20261d` |
| Reading surface | `--surface` | `#fdfcf6` | `#262d22` |
| Secondary surface | `--surface-2` | `#eeeee3` | `#30392a` |
| Course rail | `--rail` | `#f0f1e7` | `#242c20` |
| Heading ink | `--ink` | `#30372c` | `#f1efdf` |
| Body text | `--text` | `#41483b` | `#dcdfce` |
| Muted text | `--muted` | `#646b5d` | `#b9c0ad` |
| Fine rule | `--line` | `#e0e2d5` | `#414a39` |
| Control / stronger rule | `--line-strong` | `#bfc5b3` | `#657159` |
| Honey action | `--honey` | `#edc569` | `#e5bd67` |
| Honey text | `--on-honey` | `#3b321b` | `#3b321b` |
| Sage cue / focus | `--sage` | `#526748` | `#b6cca2` |
| Sage selection ground | `--sage-soft` | `#e5ebdc` | `#35462e` |
| Destructive / error cue | `--cherry` | `#a04438` | `#efaaa0` |
| Source / information cue | `--mineral` | `#486875` | `#afcbd2` |

Primary buttons and **Record lecture** use honey. Selection, navigation markers,
timestamp links, and focus cues use sage. Destructive actions retain a separate
red-brown cue and explicit labels. Status text conveys meaning alongside color.
Compatibility aliases remain in the stylesheet: `--primary` maps to sage,
`--solar` to honey, and `--solar-pale` to the sage selection ground.

**Color theme** is a labeled native select in the course rail and mobile drawer.
System is the default; Light and Dark override it. The browser-local
`lecnote-theme` preference is separate from backend settings. System follows
`prefers-color-scheme` changes. A blocking head script sets `data-theme` and
`color-scheme` before React renders, and unavailable storage does not prevent a
session choice. Lecture plots, diagrams, and recording waveforms follow the
theme as well as the surrounding controls.

## Type, mark, and surfaces

- Headings use bundled **Newsreader**, then Iowan Old Style, Palatino Linotype,
  and Georgia. `web/src/assets/fonts/Newsreader-variable.ttf` covers normal weights
  200–800; `font-display: swap` keeps content readable during font loading.
  Its SIL Open Font License is included at `web/src/assets/fonts/OFL-Newsreader.txt`.
- Body text and labels use Avenir Next, Segoe UI, and platform sans-serif
  fallbacks. There is no runtime font CDN. The mono stack is reserved for values
  such as the recording timer and code, not decorative metadata throughout the UI.
- Base text is 15px with a 1.6 line height. Page headings are 32px, falling to
  26px on phones; section headings are 21px and the compact index heading is
  26px. Note paragraphs use a 1.85 line height and a maximum width of 72ch.
  Global letter spacing is 0.
- The geometric bee is an inline SVG beside the LecNote wordmark; it is
  decorative to assistive technology because the link already names the app.
  `FieldGuideMark.tsx` uses theme colors; `web/src/assets/bee.svg` is the favicon.
- Shared radii are 8px for controls, 12px for larger surfaces, and 16px for
  dialogs. Lecture and materials rows stay simple, with fine rules and soft
  selection grounds. The selected lecture has a 1px sage edge.
- Ordinary surfaces have no shadow. Menus and dialogs use the shared 18px/48px
  offset/blur shadow (`--shadow-lg`); focus rings remain distinct from decoration.

## Workspace structure

- **Header (76px):** bee and LecNote wordmark, Library/Courses/Materials/Search,
  a persistent honey **Record lecture** action, and quieter Jobs/Settings links.
  Active capture shows its real recording or paused state and elapsed time.
- **Course rail (212px):** a soft paper-green ground, My courses, explicit
  **All courses**, every course in a scrollable list, Manage courses, theme
  selection, and the actual local connection status. Course links preserve
  context and follow the Materials destination when it is active.
- **Library:** heading and brief guidance, **Add lecture** menu for recording
  upload or transcript import, search/course/status filters, contextual
  **Merge recordings**, and ruled rows for title, course, status, duration, and
  date. Desktop rows have a 76px minimum height; compact index rows use 84px.
- **Reading workspace:** a `clamp(272px, 22vw, 340px)` lecture index beside the
  reader. The reader keeps title, course assignment, actions, source player,
  preparation and processing, then Notes/Transcript/Materials/Review/Relevance.
  Notes and reusable course materials share the sheet; the material column is
  `minmax(220px, 270px)`. Close returns to the lecture's course library and
  retains existing unsaved-edit confirmation behavior.
- **Materials:** explicit course selection, local search, safe source preview,
  **Open original**, and access to the existing management dialog. The
  all-course state shows course destinations without fetching each course's
  materials. Lecture attachments remain distinct from reusable course resources.
- Standard pages use 40px top and 44px side padding, with a 1440px maximum
  content width. The reader has its own 34px top and 32px side padding.

Loading, empty, error, recovery, unsaved, and processing states stay tied to real
application state. The redesign does not simulate progress or completion, alter
source content, or bypass explicit capture and paid-generation actions.

## Motion and responsive behavior

Selection and navigation markers use 160ms; menus, dialogs, previews, drawers,
and content reveals use 180ms with `cubic-bezier(0.2, 0.7, 0.2, 1)`. Content is
visible by default. `prefers-reduced-motion: reduce` removes animation and
transition and restores automatic scrolling.

- At 1320px and below, utility labels become visually hidden but remain accessible.
- At 1180px and below, course materials move below notes behind Show/Hide.
- At 1100px and below, the lecture index hides and an explicit **Lectures**
  return link accompanies the full-width reader.
- At 900px and below, the header becomes 112px in two rows and the course rail
  becomes a labeled drawer. Focus enters it on opening; Escape closes it and
  returns focus to its toggle. The theme control stays in this drawer.
- At 420px and below during capture, the bee becomes the compact wordmark;
  the LecNote link retains its accessible name and the elapsed timer stays visible.
- At 640px and below, headings and spacing contract and lecture rows prioritize
  the title and status. At 1680px and above, the reader can show its note outline.

Keyboard focus, labeled controls, readable contrast, content reflow, and reduced
motion are requirements of both themes. They are review criteria, not a claim
of formal accessibility certification.

## Review evidence and release status

The production build, 132 frontend unit tests, and 39 Chromium browser checks
pass. An independent visual review approved the eight library/reader captures
in both themes at 1440px and 390px. Active recording is also checked at 320px.
Current selected screenshots are under `.impeccable/review/field-guide/`, using
synthetic fixtures from `web/tests/fixtures/demo-library.ts`; they contain no
real library data. Older images directly under `.impeccable/review/` and the
Course Editions comp document the previous design. No new release or deployment
is implied by these source changes.

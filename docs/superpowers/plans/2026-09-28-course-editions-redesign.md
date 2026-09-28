# Course Editions Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the whole LecNote workspace around the approved side-by-side Course Editions composition, improving navigation, materials discovery, control density, and purposeful motion without losing existing workflows.

**Architecture:** Keep React, the hash router, existing resource hooks, recorder lifetime, and FastAPI contracts. Add a reusable course-materials panel and dedicated Materials route; reshape the shell, library, and lecture layout around these existing behaviors. Use shared design tokens and native CSS motion rather than a second component framework.

**Tech Stack:** React 19, TypeScript, Vite 6, lucide-react, existing Markdown/KaTeX components, Vitest/Testing Library, Playwright, existing Python test suite.

**Spec:** `.impeccable/surfaces/web-src-app-tsx.md`, `PRODUCT.md`, and approved `.impeccable/mocks/course-editions-original.png` with its `.png.json` approval record.

## Global Constraints

- Do not stop, restart, or modify existing running servers or active libraries.
- Work only in `/Users/csingh/.codex/worktrees/lecnote-impeccable/LecNote` on `codex/impeccable-redesign`; use a separate free preview port and synthetic test data.
- Preserve recording, import, merge, materials, note generation, transcript editing, review, export, and recovery behavior.
- Do not start paid AI generation or microphone/sharing capture without the existing explicit user actions.
- Letter spacing is `0`; corners are at most `8px`; page headings are at most `32px`; body text stays readable at `15-16px`.
- Keep solar-yellow course navigation, near-white study surfaces, dark ink, cherry recording actions, and mineral-blue source cues.
- Source content is real library data. Never seed the generated mockup's lectures, file sizes, or previews into an actual library.
- Core text and controls are semantic HTML. Keep lucide icons, focus visibility, keyboard operation, and reduced-motion support.
- Commit and push each verified milestone; update README implementation status accurately. Do not publish a new release or merge this redesign to main as an incidental step.
- No new backend inference engine, C/C++ rewrite, paid generation, or unrelated API changes in this frontend redesign.

## Review Focus

- Rapid course changes must never show another course's materials or leave a stale source preview open: task 1 component test and task 2 route test.
- Long course/resource/lecture names and more than eight courses must remain reachable without overlap at 320px, 390px, 1280px, and 1440px: task 2 browser checks.
- Navigation, menus, and previews must work with keyboard only, and reduced motion must not hide content: tasks 2 and 4 browser checks.
- An active or paused recording must survive route changes and remain discoverable: task 3 browser regression.
- Unsaved transcript/preparation edits, busy processing, and absent credentials must retain their existing protections after controls move: task 3 component regressions.

---

### Task 1: Reusable Course Materials

**Files:** Create `web/src/components/CourseMaterialsPanel.tsx`, `web/src/components/CourseMaterialsPanel.test.tsx`, `web/src/pages/Materials.tsx`, `web/src/pages/Materials.test.tsx`. Reuse `web/src/components/ClassResources.tsx`, `web/src/lib/api.ts`, and `web/src/types.ts` without changing their storage contracts.

**Interfaces:**
- Consume `courseResourcesPath(courseId: string)`, `useResource<Resource[]>(path)`, `Course`, `Resource`, and `ClassResources({course, onClose})`.
- Produce `CourseMaterialsPanel({course, layout}: {course: Course; layout?: "rail" | "page"})` and `MaterialsPage({courses, initialCourse}: {courses: Course[]; initialCourse?: string})`.
- The panel lists/searches the selected course's resources, previews extracted text, and opens the original file. A clearly labeled Manage materials action opens the existing full upload/note/edit/delete dialog; closing it refreshes the panel.
- The page exposes an explicit course selector; the all-course state lists course destinations instead of fetching every resource in parallel.

- [ ] Write tests `shows only the selected course resources`, `clears source preview when course changes`, `shows resource errors with retry`, `opens existing management and refreshes on close`, and `does not fetch every course in the unselected state`. Assertions include:

```tsx
expect(screen.getByText("Energy reference.pdf")).toBeVisible();
expect(screen.queryByText("Accounting notes.md")).not.toBeInTheDocument();
expect(screen.getByRole("link", { name: "Open original" }))
  .toHaveAttribute("href", "/api/courses/phy101/resources/source-1/file");
```

- [ ] Run `npm --prefix web test -- src/components/CourseMaterialsPanel.test.tsx src/pages/Materials.test.tsx`; confirm failures identify absent behavior, not broken fixtures.
- [ ] Implement the two components using current request cancellation, errors, native controls, and modal behavior. Use `encodeURIComponent` for IDs; render resource text as text/Markdown through the existing safe renderer, never raw HTML.
- [ ] Run `npm --prefix web test` and `npm --prefix web run build`. Update README to distinguish implemented components from the still-pending routed redesign.
- [ ] Commit and push the verified materials milestone.

### Task 2: Shell and Side-by-Side Library

**Files:** Modify `web/src/App.tsx`, `web/src/App.test.tsx`, `web/src/pages/Library.tsx`, `web/src/pages/Library.milestone5.test.tsx`, `web/src/components/ui.tsx`, and `web/src/styles.css`. Create `web/src/components/ActionMenu.tsx`, `web/src/components/ActionMenu.test.tsx`, `web/tests/redesign.spec.ts`, and synthetic fixtures under `web/tests/fixtures/`.

**Interfaces:**
- Consume task 1's `CourseMaterialsPanel` and `MaterialsPage`.
- Produce `ActionMenu({label, items}: {label: string; items: Array<{id: string; label: string; icon: LucideIcon; onSelect: () => void; disabled?: boolean}>})`.
- Add `onCourseChange?: (courseId: string) => void` to `Library`; keep existing `onNew(mode, courseId)` and merge callbacks. In App, course selection updates the hash so the left index, library filter, and Materials link agree.
- Preserve `#/record` as a valid route even though recording becomes a header action. Add `#/materials?course=<encoded-id>` to known routes; retain the not-found view.

- [ ] Measure the approved comp using `comp-spec --grid`, per-element regions, `font-match --measure`, and `font-match --rank`; record the approved 32px heading correction. Follow the spec and plates gates before writing visual page code. No font selection from memory and no UI rasterization.
- [ ] Add failing tests for the Materials destination, ten reachable courses, active course selection, Add lecture menu imports with selected course, Escape/focus restoration, and the existing merge flow reached through its contextual command. Key assertions:

```tsx
expect(screen.getByRole("link", { name: "Materials" }))
  .toHaveAttribute("href", "#/materials?course=phy101");
await user.click(screen.getByRole("button", { name: "Add lecture" }));
await user.click(screen.getByRole("menuitem", { name: "Import transcript" }));
expect(screen.getByLabelText("Course")).toHaveValue("phy101");
```

- [ ] Run the focused Vitest tests and verify the intended failures before implementation.
- [ ] Implement the compact top navigation, persistent recording action, yellow course rail, explicit All courses state, contextual Add lecture/import/merge actions, and library/materials columns. Keep every course reachable. Move shared tokens into the existing stylesheet rather than stacking a second theme on old overrides.
- [ ] Use semantic rows and real selection only where it has a working purpose. Keep duration/date/status aligned, long names wrapping, and all-course labels truthful. No ornamental checkboxes or overflow buttons with no behavior.
- [ ] Implement the approved first viewport with isolated demo fixtures and complete the hero gate, then apply its shared system to the remaining library states. All generated image text is replaced by semantic content.
- [ ] Run `npm --prefix web test`, `npm --prefix web run build`, and the navigation/browser tests on a new strict-port server. Verify 320px/390px/1280px/1440px geometry without extra screenshot-polish loops.
- [ ] Update README status, commit, and push the shell/library milestone.

### Task 3: Reading and Remaining Screens

**Files:** Modify `web/src/pages/Lecture.tsx`, `web/src/components/Lecture.test.tsx`, `web/src/components/Preparation.tsx`, `web/src/components/Preparation.css`, `web/src/components/StorageStatus.css`, `web/src/components/Materials.tsx`, `web/src/components/Notes.tsx`, `web/src/pages/Record.tsx`, `web/src/pages/Courses.tsx`, `web/src/pages/Jobs.tsx`, `web/src/pages/Search.tsx`, `web/src/pages/Settings.tsx`, `web/src/styles.css`, and focused existing tests where user-visible controls change.

**Interfaces:** Preserve all existing component callbacks, especially Lecture `onDirty`, Preparation `onDirty/onReady/onBusy`, recorder state, and processing handlers. Reuse task 1's material panel for the actual lecture course. Do not broaden backend mutations.

- [ ] Extend regressions for notes visible alongside preparation, dirty transcript navigation rejection, dirty preparation blocking generation, keyboard tab switching, unavailable-key behavior, failed processing retry, and recording survival across Library/Materials/Record navigation. Assert no paid-generation or capture request on navigation alone.
- [ ] Run the focused Lecture/Preparation/Record tests to confirm each new behavior test fails as intended; unchanged safeguards may remain green characterization tests.
- [ ] Reorganize Lecture into a compact title/player, reading area, and secondary preparation/processing context. Keep full export, deletion confirmation, transcript, relevance, attachments, and review actions; display course resources separately from lecture attachments. Maintain disabled/readiness conditions verbatim while moving their controls.
- [ ] Apply the approved shell/type/control system to Record, Courses, Jobs, Search, Settings, modals, and error/empty/loading states. Preserve native recording-source selection, storage preferences, secret handling, and retry/cancel actions. Remove redundant decorative eyebrows, not meaningful validation or error content.
- [ ] Run the full frontend suite/build and relevant browser recording/preparation/merge flows. Update README, commit, and push the all-screens milestone.

### Task 4: Motion, Responsive Verification, and Finish

**Files:** Modify existing component styles and `web/tests/redesign.spec.ts`; create verified review evidence under `.impeccable/review/`. Finish `DESIGN.md` and `.impeccable/design.json` through the shipped documenter. Update README and this plan's completion boxes.

**Interfaces:** Use `prefers-reduced-motion: reduce`; do not alter recording/media timing or native control behavior. Course markers use 160ms changes; previews/dialogs use 180ms reveals; no unbounded animation or hidden-by-default content.

- [ ] Write browser checks for reduced-motion visibility, menu/drawer focus and Escape, long titles, resource errors, dense courses, and no horizontal overflow. Assert representative animation durations become zero/near-zero under reduced motion and controls remain operable.
- [ ] Run the checks before motion/responsive implementation and confirm the target failures.
- [ ] Implement purposeful transitions and narrow-screen course/material disclosures. Keep stable table/control dimensions, native scrolling, and full-width reading without overlapping panels.
- [ ] Complete Impeccable sections/motion/responsive gates. Capture all required desktop/mobile routes in one batched screenshot round, inspect every capture, fix as one batch, and use at most one confirmation round. Run the single mechanical detector, then the fresh shipped finish reviewer with approved comp, specs, diffs, and all viewport evidence.
- [ ] Address only the reviewer's material findings within its bounded verdict rounds. Have the shipped documenter produce token-bearing DESIGN.md and design.json from the finished app.
- [ ] Run full backend tests, frontend tests/build, browser tests, and repository lint/format checks. Confirm original server identities/ports are unchanged and only the isolated preview was started. Report any unverified real-device or paid-AI behavior explicitly.
- [ ] Update product/setup/status docs, record verification evidence, commit, and push the verified final milestone. Leave the independent preview running and share its URL. A redesign is appropriate for a future minor version, but keep released `1.0.2` metadata until a new release is authorized.

## Plan Review

The four tasks cover every approved screen, material discovery, crowded commands,
motion, and personality. No storage/inference rewrite is required. The five
high-risk input classes above have owning tests. Native execution is recommended
because the work shares one shell and stylesheet; independent finish review is
still required. Implementation awaits the user's execution-method choice.

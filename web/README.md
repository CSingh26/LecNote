# LecNote Web UI

React/TypeScript workspace for the local LecNote API. All product data comes
from `/api`; the application has no seeded lectures or simulated controls.

## Development

Use Node.js 20.19+ (or 22.12+) and npm:

```sh
cd web
npm ci
npm run dev
```

Vite binds to `127.0.0.1:5173` by default and proxies `/api` to
`http://127.0.0.1:8765`. Start the Python backend separately using the root
project instructions. Vite chooses another port when its default is occupied.

```sh
npm run typecheck
npm test
npm run build
```

The production bundle is written to `web/dist/`, which the Python backend
serves. The recorder worklet is a hashed `/assets/` file, so it uses the same
production static-file mount. All Markdown, math fonts, and diagrams are
bundled locally; no font or rendering CDN is needed.

## Implemented Workflows

- Empty library, filters, course create/edit/delete, media upload with lecture
  context and course selection, JSON/text/SRT/VTT transcript imports.
- Lecture status polling; Notes, Transcript, Materials, and Review views;
  source playback and timestamp seeks; transcript and speaker corrections;
  separately saved personal notes; source uploads/previews/deletion.
- Markdown, HTML, PDF, and JSON exports; cross-lecture search and course
  glossary; job status/cancel/retry; local-only transcription without an API key.
- Model, Whisper, chunk length, concurrency, prices, language, and diarization
  settings. Secret inputs stay blank and are omitted unless explicitly changed
  or cleared. Saved-note estimates use token counts and configured prices.
- Click-initiated microphone capture in a module-owned WebAudio recorder that
  survives navigation. Independent 15-second mono PCM16 WAV chunks upload
  serially with sample-derived offsets. Stop flushes the partial final chunk,
  waits for uploads, then calls finish. Failed uploads remain in memory for
  explicit retry; a combined WAV is downloadable. The browser warns before
  leaving an active/unfinalized recording. Reloading or closing the tab still
  discards any audio not uploaded or downloaded.
- Recording is available directly from the library header and New lecture.
  Source modes capture microphone, shared lecture audio, or both. Shared audio
  uses the browser's consent picker; support depends on the browser/OS and
  the chosen surface. Both inputs are mixed at half gain before PCM encoding.
  Video tracks are kept only for sharing lifetime, never saved or uploaded.
  Stopping sharing saves the audio and releases every input track. Missing
  shared audio and denied permissions return actionable errors without fallback.
- Responsive sidebar, focus-trapped dialogs, Escape handling, arrow-key lecture
  tabs, loading/error/empty states, and unsaved-edit navigation warnings.

Raw HTML is skipped in Markdown. KaTeX disables trusted commands. Mermaid is
configured with strict security and its SVG output is sanitized with DOMPurify.
Attachment previews use same-origin API endpoints. No secrets are bundled.

## Frontend Verification

Vitest and Testing Library cover timestamp parsing, JSON validation, PCM WAV
encoding, serial upload recovery, worklet downmixing/final partial chunks,
empty states/dialogs, draft uploads, courses, settings secret omission,
transcript/note edits, local transcription, diarization defaults, file-read
title races, safe Markdown, and saved-note cost estimates.

With Vite running on port 5173:

```sh
npm run test:browser
```

Set `LECNOTE_TEST_URL` to check a built app served by the Python backend instead.

Playwright uses an installed Chromium browser (install it with
`npx playwright install chromium` if necessary). These frontend browser tests
use explicit test API fixtures and Chromium's simulated microphone. They cover
native upload submission, desktop/mobile layouts, keyboard focus, microphone
consent timing, navigation during recording, exact chunk offsets, and finish
ordering. Screenshots go to ignored `web/test-results/`.

Real backend/inference integration is verified separately. The frontend suite
does not claim a live OpenAI call, physical microphone verification, or testing
in Safari/Firefox.

Runtime dependencies: React, React DOM, lucide-react, react-markdown,
remark-gfm, remark-math, rehype-katex, KaTeX, Mermaid, and DOMPurify.
Development dependencies: Vite, TypeScript, Vitest, Testing Library, jsdom,
Playwright, Prettier, and the corresponding React/Node type declarations.

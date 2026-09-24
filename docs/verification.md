# Verification record

## v1.0.1 isolated verification

Work and test libraries are isolated from the running v1.0.0 checkout and recording.
No running-app restart, branch switch, data migration, physical microphone capture,
paid OpenAI request, or Docker image execution was performed for this branch.

- Python: 304 tests passed; Ruff and Git whitespace checks passed.
- Frontend: 77 unit tests and 13 Chromium browser tests passed; production build passed.
- The real API plus production UI smoke passed class creation/resources, preparation,
  deterministic note generation, manual relevance edits, notes retention across class
  reassignment/reload, annotations, search, PDF export, and desktop/mobile layouts.
- Browser screenshot inspection confirmed fit at 1440, 390, and 320 pixels for new controls.
- Python tests cover full-transcript topic mapping, conservative classifications,
  cached retries, failure checkpoints, class-resource scoping, real synthetic FFmpeg
  joins/compression, six-hour eligibility, corruption/cancellation, provenance, and
  recording/maintenance concurrency. The six-hour threshold is clock-injected;
  verification does not wait six hours or use a real multi-hour recording.
- Branch CI includes FFmpeg, frontend/browser tests, production build, and the isolated
  API smoke. Image publishing intentionally remains restricted to version tags.
- The initial expanded Ubuntu CI exposed shortened FFmpeg progress timestamps in
  merged transcript offsets. The correction uses the verified stream duration and
  adds regression tests for short progress and incomplete decoding; the corrective
  push reruns the full branch workflow.

Run `npm --prefix web run test:browser` to start and stop an isolated Vite test server
automatically on port 4175. API traffic and recording inputs in that suite are fixtures.
For the real-API smoke below, the default isolated test server port is now 8871.
Whisper's recognition accuracy and GPT-5.4 mini's semantic note quality were not
re-evaluated with live models; the new inference boundaries are mocked in tests.

## v1.0.0 historical verification

Verified on this Apple Silicon macOS laptop and with GitHub Actions on Ubuntu
24.04 on September 24, 2026.

## Automated checks

- Python: 178 tests passed across API, persistence, job recovery, processing,
  OpenAI request boundaries, OCR/speaker adapters, exports, and CLI.
- Frontend: 38 Vitest tests passed; TypeScript and production build passed.
- Frontend Chromium suite: eight tests passed with explicit API fixtures.
- Ruff and Git whitespace checks passed.
- Notes retention checks cover detail/course/material/transcript edits, failed
  regeneration, local-only transcription, recovery from saved notes files, and
  a course edit racing with generation completion. Browser integration verifies
  ACC502 assignment and unchanged notes after detail saves and reload. Recorder
  tests verify no live transcript content or detail polling during capture.
- Oversized supporting materials use bounded, chunk-specific excerpts, with
  source preservation, Unicode, overview generation, cached retries, and changed
  material invalidation covered. A local size-only check of the affected saved
  lecture verified all eight chunks fit the request limits without an OpenAI call.
- The app shell uses `Cache-Control: no-store`. The user's existing Chrome tab
  was safely refreshed after recording stopped; its recorder has no transcript panel.
- Independent review findings were fixed and regression-tested, including live
  cancellation/edit races, transcript constraints, timestamp overruns, Markdown
  math escaping, and CJK PDF output.

## Browser integration

`tests/browser_server.py` runs the real local API and storage against an isolated
test library, with deterministic note generation instead of paid OpenAI calls.
`tests/browser-smoke.mjs` verifies course creation, transcript import and editing,
notes, math, diagram labels, annotations, review answers, PDF download, search,
settings, and 1440px desktop/390px mobile layouts. Screenshot inspection is part
of verification, not just an assertion that the page loaded.

The recording run uses Chromium's simulated microphone fed with generated
speech. Real local Whisper transcribes the independent WAV chunks; the full
recording remains playable after completion. Navigation during recording and
the waveform canvas were verified. No physical microphone was accessed.

The mixed-source browser tests substitute generated 220 Hz and 880 Hz streams
at the browser permission boundary. The real WebAudio mixer, worklet, and WAV
encoder run unchanged. Spectral checks confirm both inputs in the final WAV.
Tests cover manual stop, ended sharing during capture and setup, release of all
audio/video tracks, source selection, and New lecture metadata handoff across
consecutive recordings. No actual screen-sharing
permission was granted during automation. Native picker/device compatibility
still depends on the user's browser and macOS permissions.

Pause/resume tests verify sample-level exclusion of paused audio and elapsed
time, partial-chunk flushing, repeated resumes, stopping while paused, and
sharing ending while paused. Browser checks cover the paused navigation banner,
reload protection, a single recording session, continuous upload offsets, hidden
transcript, and desktop/mobile controls. Input devices remain connected during
a pause; their audio is discarded by the capture worklet until resume.

Reproduce the integration check in separate terminals after building the UI:

```sh
LECNOTE_TEST_DATA=artifacts/browser-library .venv/bin/python tests/browser_server.py
node tests/browser-smoke.mjs
```

Set `LECNOTE_TEST_MICROPHONE` to a WAV file to include the synthetic-microphone
path. Artifacts and screenshots are under ignored `artifacts/browser/`.

## Real local checks

- Downloaded the base Whisper model and transcribed generated speech locally.
- Ran the CLI end to end in `--transcribe-only` mode and produced JSON output.
- Exercised Apple Vision image OCR locally.
- Imported the installed pyannote audio pipeline successfully. Speaker-model
  inference is not verified because no Hugging Face token/model access was supplied.
- Inspected offline HTML, numeric plots, diagrams, formulas and CJK PDF output.

## Limits

No live OpenAI call was made: note generation still needs an OpenAI API key.
No physical classroom recording, multi-hour workload, Safari/Firefox run,
Windows runtime, or live Linux recording/inference was tested. Small Whisper
models can mishear numerical expressions; review important formulas against the
recording.

The build reports large JavaScript chunks from the math/diagram dependencies.
The Python suite reports a Starlette/httpx test-client deprecation warning.
Neither warning blocks the verified workflows.

The v1.0.0 release workflow passed Python and frontend checks on a GitHub-hosted
Ubuntu 24.04 runner. Its tagged run built and published the container image.
The image was built but not run locally or on the GitHub runner.

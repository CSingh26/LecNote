# Verification record

Verified on this Apple Silicon macOS laptop on September 23, 2026.

## Automated checks

- Python: 157 tests passed across API, persistence, job recovery, processing,
  OpenAI request boundaries, OCR/speaker adapters, exports, and CLI.
- Frontend: 28 Vitest tests passed; TypeScript and production build passed.
- Frontend Chromium suite: five tests passed with explicit API fixtures.
- Ruff and Git whitespace checks passed.
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
No physical classroom recording, multi-hour workload, Safari/Firefox run, or
Windows/Linux runtime was tested. Small Whisper models can mishear numerical
expressions; review important formulas against the recording.

The build reports large JavaScript chunks from the math/diagram dependencies.
The Python suite reports a Starlette/httpx test-client deprecation warning.
Neither warning blocks the verified workflows.

The available GitHub login cannot create workflow files. CI is therefore supplied
as `docs/github-actions-checks.yml`, not enabled remotely. An authorized account
can place that template at `.github/workflows/checks.yml` to enable the checks.

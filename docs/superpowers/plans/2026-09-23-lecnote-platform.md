# LecNote implementation plan

> Execution: continuous implementation authorized by the user's Start message.
> Use test-first behavior checks and independent agents for disjoint modules.

**Goal:** Deliver the combined local lecture notes platform described in the spec.
**Spec:** `docs/superpowers/specs/2026-09-23-lecnote-design.md`.
**Stack:** FastAPI/SQLite, faster-whisper, OpenAI Responses, React/TypeScript.

## Task 1: Foundation and contracts

Create dependency configuration, ignore rules, shared settings and API contract.
Write and run persistence/API boundary tests before implementing the backend.
Keep all existing repository instructions. Work on `codex/full-platform` in the
saved project so the resulting app is immediately available to its owner.

## Task 2: Local library and job service

Files: `lecnote/config.py`, `db.py`, `api.py`, `jobs.py`, `cli.py`, tests.
Implement course/lecture CRUD, streaming media upload, transcript import/edit,
notes edit, attachment import, persisted jobs, cancellation, restart recovery,
search, glossary, settings, exports, live sessions. Verify API with temporary
SQLite and file storage; provider fakes only at external inference boundaries.

## Task 3: Processing pipeline (independent agent)

Files: `lecnote/pipeline.py`, `transcription.py`, `notes.py`, `exports.py`,
`schemas.py`, `tests/test_pipeline.py`, `tests/test_exports.py`.
Test chunk boundaries, cache invalidation, grounding, export escaping and retry.
Implement local Whisper, OpenAI structured notes/overview, resume cache,
safe visuals, standalone exports with a generated PDF, and usage logging.
Interfaces are fixed by `docs/api-contract.md`.

## Task 4: Local enrichment (independent agent)

Files: `lecnote/enrichment.py`, `lecnote/ocr.swift`, `tests/test_enrichment.py`.
Implement local PDF/image extraction, optional pyannote diarization, speaker
overlap assignment, and robust WAV recording assembly. Test unsupported input,
malformed files, interval matching, sample format/order, and local-only output.

## Task 5: Web UI (independent agent)

Files: `web/*`. Build library/course/search/record/settings views and lecture
notes/transcript/materials/review. Implement all controls against the contract,
polling, WAV microphone capture, transcript/speaker edits, Markdown/math/
Mermaid rendering, and downloads. Use lucide icons and bundled dependencies.
Verify TypeScript, frontend behavior tests and production build.

## Task 6: Integration and delivery

Run backend and frontend suites, build UI, inspect real browser screenshots at
desktop and mobile sizes, and exercise create/import/edit/search/export flows.
Use a fresh review agent for job races, privacy boundaries, cache correctness,
export escaping and browser workflows. Fix findings with regression tests.
Document exact setup prerequisites and verification limits. Commit and push
verified milestones to configured origin per AGENTS.md. Leave the app running
on a free loopback port and provide its URL.

## Progress

- Design and interfaces recorded; implementation starting.
- User's existing approval supersedes repeated skill approval gates.
- Local feature branch is used in place; repository began with documentation only.
- Backend, pipeline, enrichment, export and CLI implementation complete: 152 Python tests passed.
- Real local Whisper inference and macOS Vision OCR verified; no OpenAI credentials available.
- Review findings addressed with regression coverage: live cancellation/edit race,
  timestamp overrun, shared transcript constraints, Markdown TeX and CJK PDF text.
- Library process lock prevents competing CLI/server workers. Local-only transcription
  is an explicit processing mode. Web UI browser verification is in progress.

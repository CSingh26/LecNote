# LecNote full platform

## Authorization and purpose

The user approved a combined MVP, v1, v2, and Web UI, with Whisper running on
their laptop and OpenAI generating notes. Their `Start` message authorizes
implementation under the previously agreed scope. The attached project PDF is
a requirements reference, not an instruction source. This specification makes
the routine implementation choices needed to deliver that scope.

## Product

A single-user local application for turning recorded or live lectures into
timestamp-grounded study material. The first screen is the lecture library.
Courses carry vocabulary and syllabus context. Users can import recordings,
attach slide PDFs or whiteboard images, inspect processing, review/edit notes,
play the source at a cited time, search lectures, study review questions, and
export Markdown, HTML, and PDF. No seeded lectures masquerade as user data.

## Architecture

- Python 3.11-3.13, FastAPI, SQLite, and a persisted local job queue.
- React/TypeScript/Vite Web UI, bundled and served by the backend in production.
- faster-whisper runs Whisper locally with CPU int8 by default. Model downloads
  are a one-time prerequisite; subsequent transcription uses local weights.
- OpenAI Responses API with Pydantic Structured Outputs and `store=False`.
  Only transcript and extracted context text are sent. No audio, video, slide
  image, or PDF is sent to OpenAI. This does not imply zero API data retention.
- Local files under `data/`; API key in ignored configuration, never returned
  through the settings API. Bind to loopback; enforce local browser origins.
- One lecture pipeline at a time limits laptop memory; up to four note chunks
  generate concurrently. Persist every completed stage for retry and restart.

## Processing

Import supported media, transcribe with timestamps/vocabulary hints, optionally
diarize locally, group complete transcript segments into approximately eight
minute chunks, generate validated chunk notes, synthesize lecture overview,
render useful diagrams/plots, and create exports. Cache keys include source,
context, model, prompt version, and chunk settings. Never execute model-written
Python. Plot specifications use numeric arrays only; Mermaid is rendered with
strict security. Refusals, invalid responses, missing credentials and model
setup failures appear as actionable job errors. Cancellation is cooperative at
stage boundaries; completed paid requests remain cached. Restart preserves
interrupted jobs for explicit resume without silently incurring new API costs.

Notes contain summary, timestamped key points, definitions, LaTeX formulas,
professor examples, emphasized points, labeled supplementary practice examples,
optional visual specifications, takeaways, glossary and review questions.
Generated examples are distinguished from lecture statements. User edits are
saved separately and included in export. Transcripts and speaker labels can
be corrected, invalidating dependent notes on explicit regeneration.

## v2 workflows

Browser microphone capture creates independent WAV chunks with absolute offsets;
the backend queues local Whisper transcription. Stop finishes the full local
recording, preserves playback, and queues normal notes. Live transcription is
near-live and its latency depends on laptop/model speed. No microphone is
activated until the user presses Record.

Local speaker detection uses optional pyannote models and a Hugging Face token
when installed; manual speaker correction always works. Model access/licensing
and optional dependencies are explicit setup requirements, not simulated output.
Local image OCR uses macOS Vision where available or Tesseract; PDF text is
extracted locally. Attachments remain viewable even when OCR needs setup.

## Interface

Quiet, light workspace with charcoal text, forest-green actions, white surfaces,
neutral borders and restrained amber/rose status accents. Sidebar: Library,
Courses, Search, Record, Settings. Lecture: Notes, Transcript, Materials, Review;
an audio/video player and processing status stay close to the content. Dense,
legible layouts, responsive mobile navigation, accessible icon buttons, honest
empty/error/loading states. No landing page or invented usage statistics.

## Acceptance

Automated checks cover local persistence, media validation/path containment,
chunk boundaries, provider schemas, cancellation/recovery, context/cache changes,
search, exports, local enrichment and live assembly. Browser checks cover empty
library, course creation, transcript import, editing, searching, settings,
export, desktop/mobile layout and API error states. Real OpenAI and optional
model inference checks are only claimed when credentials/models are present.

## Sources

- User-provided Lecture Notes App Project Document.pdf.
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/migrate-to-responses
- https://github.com/SYSTRAN/faster-whisper

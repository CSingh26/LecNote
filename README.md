# LecNote

## v1.0.1 release

LecNote v1.0.1 adds a class-centered study workflow.
Class libraries now store reusable local materials and typed notes. Recording/import
processing only transcribes locally. AI notes require a recording note or explicitly
selected readable resources from the lecture's class, followed by Generate notes.
Full-lecture relevance now maps the entire transcript before classifying speech as
course material, class logistics, off-topic, or needing review. Uncertain speech is
retained in notes with uncertainty; the original transcript is never removed.
Manual relevance changes mark saved notes outdated until regeneration.
The backend supports ordered same-class recording merges and verified six-hour
audio compression. Sources are preserved by merging; compression replaces an
original only after full audio validation. The Web UI now includes class resource
storage, saved lecture preparation, and the source history for generated notes.
The Library can merge ordered recording parts; the lecture Relevance tab supports
filters and manual classifications. Compression status and workspace/class
preferences are available in the Web UI.
See [the v1.0.1 guide](docs/v1.0.1.md) for the workflow, limits, privacy, and
upgrade precautions. Save any active recording and back up the library before
updating or restarting an existing installation.

A local lecture library with Whisper transcription, OpenAI study notes, and a
browser workspace. The combined MVP/v1/v2 implementation includes courses,
recording imports, live microphone capture, timestamp-linked playback,
transcript correction, local slide/whiteboard extraction, review questions,
search, course glossary, resumable jobs, and Markdown/HTML/PDF/JSON exports.

## Core features

The app includes the desktop-first Web UI, microphone and
shared-lecture audio recording with pause/resume, local Whisper transcription,
course-linked notes, and exports. GitHub Actions runs the Python and frontend
checks on pushes and pull requests. Version tags build a container image and
publish it to [GHCR](https://github.com/CSingh26/LecNote/pkgs/container/lecnote).

## Run on this laptop

```sh
bash run.sh
```

Open [LecNote](http://127.0.0.1:8765). Use `bash run.sh 8766` if the default port
is busy. Add an OpenAI API key in Settings to generate notes. Keys stay in local,
ignored configuration and are never returned to the browser after saving.
The base Whisper model and optional speaker-detection dependencies are installed
on this laptop. Speaker detection still needs model access and a Hugging Face token.

The library starts empty. Create a course, import a lecture, or start a recording.
Transcript-only imports also work. Local transcription is saved even if OpenAI
generation fails, so the transcript can be reviewed and the job resumed later.
Stopping a live recording always saves and transcribes locally, even with an
OpenAI key. Add a recording note or select class resources, save preparation,
then explicitly generate notes.

## Install on another machine

Requires Python 3.11-3.13 and Node.js 20.19+ or 22+. Python 3.14 is not supported
by this project's dependency range. FFmpeg and ffprobe are required for recording
merges and automatic compression, and for optional speaker detection.
Core Whisper decoding uses PyAV.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
npm --prefix web ci
npm --prefix web run build
.venv/bin/lecnote download-model --model base
.venv/bin/lecnote serve
```

On Windows, use `.venv\Scripts\python.exe` and `.venv\Scripts\lecnote.exe`.
`requirements.lock` records the tested Python package versions; `web/package-lock.json`
locks the frontend dependencies. macOS workflows are verified, and the automated
suite passes on Ubuntu 24.04 in GitHub Actions. Windows and live Linux
recording/inference have not been exercised.
`requirements-speakers.lock` records the tested environment including the
optional speaker-detection dependencies.

For frontend development, run the Python server on port 8765 and
`npm --prefix web run dev` in another terminal. Vite forwards `/api` to the local
server. The production build is served directly by Python without Node running.

### Container image

The image bundles the Web UI, Python server, FFmpeg, Tesseract OCR, and the
local Whisper runtime. It stores the library and downloaded model weights in
`/data`. To use the published image, bind the web port to your own computer and
keep `/data` in a persistent volume:

```sh
docker run --rm -p 127.0.0.1:8765:8765 -v lecnote-data:/data ghcr.io/csingh26/lecnote:1.0.1
```

Open [LecNote](http://127.0.0.1:8765) and add your OpenAI API key in Settings
when you want generated notes. The image does not contain keys or Whisper model
weights; the selected model downloads to `/data/models` on first use. Allow
Docker enough memory for local transcription. The container uses Linux OCR, so
macOS Apple Vision is only available with the direct laptop install. Speaker
detection is an optional direct-install dependency and is not in this image.
The image is built in GitHub Actions; building or publishing it does not start
a container on your laptop.

## Features and limits

| Area | Behavior |
| --- | --- |
| Local Whisper | CPU int8, timestamped segments, vocabulary hints, selectable model and language |
| Notes | Overview, takeaways, cited key points, definitions, LaTeX formulas, professor examples, emphasis, labeled generated practice |
| Visuals | Validated Mermaid and numeric plots; no generated Python execution |
| Courses | Context and vocabulary, lecture organization, glossary |
| Live recording | Microphone, shared lecture audio, or both mixed together; local transcription and saved full WAV recording |
| Materials | Local text/PDF extraction and image OCR; original files remain local |
| Class resources | Searchable reusable materials and typed notes; explicit per-lecture selection |
| Relevance | Full-lecture topic mapping, timestamped categories, manual overrides, separate logistics |
| Recording merges | 2-20 same-class parts, ordered compact M4A, source provenance, originals preserved |
| Compression | Eligible 6 hours after finalization, local idle worker, validated smaller replacement, opt-out |
| Recovery | Completed transcription and note chunks cached; failed/cancelled/interrupted jobs can resume |
| Exports | Markdown, standalone HTML, PDF, and JSON; includes personal annotations |
| Usage | Input/output token counts, optional estimates from user-supplied per-million prices |

The default note model is `gpt-5.4-mini` with low reasoning effort; saved custom
model selections remain unchanged. Choose another Responses-compatible
Structured Outputs model in Settings or `LN_MODEL`. Approximately eight-minute
chunks generate up to four at a time; only one lecture pipeline runs at once.
Relevance adds analysis calls; bounded excerpts, compact hierarchical summaries,
and local content-keyed caches limit repeated input. This does not guarantee a
lower bill than v1.0.0. No custom saved model is silently upgraded.
Changing source text, context, model, prompt, or chunk settings invalidates
dependent caches. Force regeneration makes new note requests and may cost more.
Completed cache usage describes the saved notes, not an account billing ledger.
Saved notes stay visible when lecture details, course context, transcripts, or
materials change. They are marked potentially out of date until successfully
regenerated. Changing the Course selector on a lecture saves its assignment
without deleting notes. New lectures inherit the class selected in the Library.

Whisper transcribes audio chunks locally in the background. The recorder shows
the timer and waveform, not a live transcript; the transcript is available on the
lecture page after recording. The browser must remain open while
recording; saved chunks survive a backend restart. Microphone access begins only
after pressing Record. A single worker owns each library, so stop the Web UI
server before running processing through the CLI against the same library.

### Record a lecture

Choose **Record lecture** in the Library, or **New lecture > Record live**.
Enter the title, select **Microphone**, **Lecture audio**, or **Both**, then
press **Start recording**. Stop & save preserves the WAV recording and queues
local transcription; an OpenAI key is needed only for the generated notes.

Use the **Pause** icon beside Stop & save to take a break, then **Resume** to
continue the same lecture. Paused audio and time are excluded from the saved WAV;
audio recorded before the pause is uploaded normally. Stop & save also works
while paused. Keep the tab open: microphone/screen-sharing access stays active
so resuming does not need another permission prompt. Ending sharing while paused
finishes and saves the recording.

For online lectures, open LecNote in desktop Chrome or Edge, select the lecture
tab in the browser's sharing picker, and enable tab audio. Audio from other apps
or the entire system is available only when the browser and operating system
offer it. A source without an audio track is rejected explicitly; it never
silently falls back to microphone-only capture. Both mode also requests microphone
access. Headphones help prevent the microphone picking up the lecture a second time.

The browser requires a display-sharing selection to access lecture audio, but
LecNote encodes and uploads audio only, not video. Ending sharing also stops and
saves the recording. macOS may require browser microphone/screen-audio permissions.
See [Chrome's capture controls](https://developer.chrome.com/docs/web-platform/screen-sharing-controls).

Recordings can be up to 4 GiB, materials up to 30 MiB. Supporting context is
limited to 24,000 characters per note-generation request. Larger lecture/course
context and attachments are kept intact locally; each request automatically uses
excerpts matched to its transcript section. Not every passage is sent in every
request. Image-only PDFs need their pages
attached as images for OCR. Complex Mermaid forms retain their source if the
PDF raster fallback cannot render them. Standalone HTML uses the locally
installed Mermaid bundle; install frontend dependencies for interactive diagrams.

Whisper can mishear numbers and terminology, especially with smaller models.
Review important formulas against the recording. Transcript text and speaker
labels can be corrected before regenerating notes. Personal annotations are
saved separately so regeneration does not overwrite them.

## Optional speaker detection and OCR

```sh
.venv/bin/python -m pip install -e '.[speakers]'
```

Automatic speaker detection needs pyannote, FFmpeg, a Hugging Face token, and
accepted access conditions for
[speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1).
For pyannote 3.x the adapter uses speaker-diarization-3.1 and segmentation-3.0.
Enable detection and set the token in Settings. Model weights download once;
inference runs locally. This optional model integration has not been exercised
with real model credentials during development. Manual speaker labels work
without this dependency.

macOS image OCR uses Apple Vision with Xcode Command Line Tools. Other systems
use the `tesseract` executable if installed. No images are sent to OpenAI.

## CLI

```sh
.venv/bin/lecnote check
.venv/bin/lecnote process lecture.m4a --title "Lecture 1" --context "Today's class covers inventory valuation"
.venv/bin/lecnote process lecture.m4a --transcribe-only
.venv/bin/lecnote process transcript.json --title "Lecture 2" --no-process
.venv/bin/lecnote process --resume LECTURE_ID --material CLASS_RESOURCE_ID
.venv/bin/lecnote --data-dir ./another-library serve --port 8766
```

Transcript JSON has `language`, `duration`, and `segments`. Each segment has an
integer `id`, `start`/`end` seconds, `text`, and optional `speaker`. An example is
in `examples/transcript.json`. CLI commands use the same local services and
cache as the Web UI. The API contract is in `docs/api-contract.md`.

## Local data and privacy

`data/library.sqlite3` stores the library and jobs. `data/lectures/<id>/` holds
source files, transcripts, content-keyed caches, generated assets, and exports.
`data/resources/<id>/` holds reusable class material originals.
`data/settings.json` stores settings with owner-only file permissions on macOS
and Linux. Keep your library backed up; none of it is committed to Git.
Settings can also begin from the variables listed in `.env.example`.

The server binds to loopback. Audio/video, PDFs and images stay on the laptop.
Only transcript and extracted context text go to OpenAI. Requests set
`store=False`; that disables response storage, not all provider-side retention.
See [OpenAI's Responses guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses).

## Verification

```sh
.venv/bin/python -m pytest -q
.venv/bin/ruff check lecnote tests
npm --prefix web test
npm --prefix web run build
npm --prefix web run test:browser
```

Tests use temporary local libraries and fake only external inference boundaries.
They never make paid OpenAI calls. Real local Whisper and Apple Vision smoke
checks were performed for v1.0.0. v1.0.1 adds synthetic FFmpeg and isolated API/UI
checks, without accessing an active recording or physical microphone.
An actual OpenAI generation run still needs a user
API key; no live OpenAI call is claimed as tested.
See [the verification record](docs/verification.md) for test scope and browser checks.

## License

LecNote's source code is licensed under the [MIT License](LICENSE). Third-party
dependencies retain their own licenses.

## Build milestones

1. Product design, architecture, API contract and dependency foundation.
2. Local library, processing, enrichment, exports and CLI.
3. Complete Web UI and browser integration verification.

Verified milestones are committed and pushed to the configured GitHub remote.
Design and implementation records live in `docs/superpowers/`.

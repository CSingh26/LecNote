import hashlib
import json
import math
import shutil
import wave
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Settings
from .db import Repository, now
from .jobs import JobManager
from .requests import (
    CourseInput,
    CoursePatch,
    ImportInput,
    LecturePatch,
    LiveInput,
    NoteInput,
    ProcessInput,
    SettingsInput,
    TranscriptInput,
)
from .resources import generation_inputs, install_resources, preparation_ready

MEDIA = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".mov": "video/quicktime",
    ".aac": "audio/aac",
}
MATERIALS = {".txt", ".md", ".pdf", ".png", ".jpg", ".jpeg", ".webp"}


async def save_upload(upload, path, limit):
    count = 0
    try:
        with path.open("wb") as out:
            while chunk := await upload.read(1024 * 1024):
                count += len(chunk)
                if count > limit:
                    raise HTTPException(413, "File exceeds the size limit")
                out.write(chunk)
        if not count:
            raise HTTPException(422, "File is empty")
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()


def create_app(settings: Settings | None = None, start_worker=True):
    settings = settings or Settings.load()
    repo = Repository(settings.data_dir / "library.sqlite3")
    manager = JobManager(repo, settings, start_worker=start_worker)

    @asynccontextmanager
    async def lifespan(app):
        yield
        manager.close()

    app = FastAPI(title="LecNote", version="1.0.0", lifespan=lifespan)
    app.state.repo, app.state.settings, app.state.jobs = repo, settings, manager
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"])

    @app.middleware("http")
    async def local_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin:
            parsed = urlparse(origin)
            if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
                "localhost",
                "127.0.0.1",
                "::1",
                "testserver",
            }:
                return JSONResponse({"detail": "Only local application origins are allowed"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def get_lecture(lecture_id):
        value = repo.get("lectures", lecture_id)
        if not value:
            raise HTTPException(404, "Lecture not found")
        return value

    def check_course(course_id):
        if course_id and not repo.get("courses", course_id):
            raise HTTPException(404, "Course not found")

    def editable(lecture_id):
        lecture = get_lecture(lecture_id)
        if manager.active(lecture_id) or lecture["status"] == "recording":
            raise HTTPException(409, "Wait for processing to finish or cancel it first")
        return lecture

    def outdated_notes(lecture):
        # Editing inputs never destroys the last successfully generated notes.
        return {"notes_stale": True} if lecture.get("notes") else {"status": "draft"}

    def public_lecture(lecture, brief=False):
        value = {
            k: v
            for k, v in lecture.items()
            if k not in {"media_path", "force", "live_epoch", "transcript_edited"}
        }
        course = repo.get("courses", lecture.get("course_id")) or {}
        value.update(
            course_name=course.get("name", "Unfiled"),
            course_code=course.get("code", ""),
            course_color=course.get("color", "#26715b"),
            job=manager.latest(lecture["id"]),
        )
        value["attachments"] = [
            {k: v for k, v in item.items() if k != "path"} for item in value.get("attachments", [])
        ]
        if not value.get("transcript"):
            cached = settings.lecture_dir(lecture["id"]) / "transcript.json"
            if cached.is_file():
                try:
                    data = json.loads(cached.read_text())
                    if "segments" in data:
                        value["transcript"] = data
                        value["duration"] = data["duration"]
                except (ValueError, KeyError, OSError):
                    pass
        value["segment_count"] = len((value.get("transcript") or {}).get("segments", []))
        value["attachment_count"] = len(value.get("attachments", []))
        value["selected_resource_ids"] = lecture.get("selected_resource_ids", [])
        value["preparation_ready"] = preparation_ready(repo, lecture)
        if brief:
            for key in ("transcript", "notes", "attachments", "user_notes"):
                value.pop(key, None)
        return value

    def new_lecture(title, course_id=None, **values):
        check_course(course_id)
        lecture = repo.create(
            "lectures",
            {
                "title": title,
                "course_id": course_id or None,
                "source_name": "",
                "media_type": "",
                "status": "draft",
                "duration": 0,
                "context": "",
                "language": "",
                "transcript": None,
                "notes": None,
                "user_notes": "",
                "attachments": [],
                "error": None,
                "media_path": None,
                **values,
            },
        )
        settings.lecture_dir(lecture["id"])
        return lecture

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/courses")
    def courses():
        lectures = repo.list("lectures")
        return [
            {**c, "lecture_count": sum(item.get("course_id") == c["id"] for item in lectures)}
            for c in repo.list("courses")
        ]

    @app.post("/api/courses", status_code=201)
    def create_course(body: CourseInput):
        return {**repo.create("courses", body.model_dump()), "lecture_count": 0}

    @app.patch("/api/courses/{course_id}")
    def patch_course(course_id: str, body: CoursePatch):
        check_course(course_id)
        values = body.model_dump(exclude_unset=True, exclude_none=True)
        with manager.lock:
            related = [item for item in repo.list("lectures") if item.get("course_id") == course_id]
            current = repo.get("courses", course_id)
            if any(values[key] != current.get(key) for key in values.keys() & {"context", "vocabulary"}):
                for lecture in related:
                    editable(lecture["id"])
                for lecture in related:
                    repo.update("lectures", lecture["id"], outdated_notes(lecture))
            return {**repo.update("courses", course_id, values), "lecture_count": len(related)}

    @app.delete("/api/courses/{course_id}", status_code=204)
    def delete_course(course_id: str):
        with manager.lock:
            check_course(course_id)
            if any(item.get("course_id") == course_id for item in repo.list("lectures")):
                raise HTTPException(409, "Move or delete this course's lectures first")
            if any(item.get("course_id") == course_id for item in repo.list("resources")):
                raise HTTPException(409, "Remove this course's materials first")
            repo.delete("courses", course_id)

    @app.get("/api/lectures")
    def lectures(course_id: str = "", q: str = ""):
        return [
            public_lecture(item, True)
            for item in repo.list("lectures")
            if (not course_id or item.get("course_id") == course_id)
            and q.casefold() in item["title"].casefold()
        ]

    @app.post("/api/lectures", status_code=201)
    async def upload(
        file: UploadFile = File(),
        title: str = Form(),
        course_id: str = Form(""),
        context: str = Form(""),
        language: str = Form(""),
        process: bool = Form(True),
    ):
        if not title.strip() or len(title) > 200 or len(context) > 100000 or len(language) > 20:
            raise HTTPException(422, "A title and valid context are required")
        check_course(course_id)
        name = Path((file.filename or "recording").replace("\\", "/")).name
        suffix = Path(name).suffix.lower()
        if suffix not in MEDIA:
            raise HTTPException(415, "Unsupported recording format")
        identifier = str(uuid4())
        folder = settings.lecture_dir(identifier)
        path = folder / ("source" + suffix)
        try:
            await save_upload(file, path, 4 * 1024**3)
            lecture = new_lecture(
                title.strip(),
                course_id,
                id=identifier,
                media_path=str(path),
                source_name=name,
                media_type=MEDIA[suffix],
                context=context,
                language=language,
            )
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        if process:
            manager.enqueue(lecture["id"], diarize=settings.diarization, transcribe_only=True)
        return public_lecture(get_lecture(lecture["id"]))

    @app.post("/api/lectures/import", status_code=201)
    def import_transcript(body: ImportInput):
        transcript = body.transcript.model_dump()
        lecture = new_lecture(
            body.title,
            body.course_id,
            context=body.context,
            transcript=transcript,
            duration=transcript["duration"],
            language=transcript["language"],
            source_name="Imported transcript",
        )
        return public_lecture(lecture)

    @app.get("/api/lectures/{lecture_id}")
    def lecture(lecture_id: str):
        return public_lecture(get_lecture(lecture_id))

    @app.patch("/api/lectures/{lecture_id}")
    def patch_lecture(lecture_id: str, body: LecturePatch):
        values = body.model_dump(exclude_unset=True)
        if "course_id" in values:
            check_course(values["course_id"])
        if any(v is None for k, v in values.items() if k != "course_id"):
            raise HTTPException(422, "Text fields cannot be null")
        with manager.lock:
            if set(values) - {"user_notes"}:
                current = editable(lecture_id)
            else:
                current = get_lecture(lecture_id)
            if any(
                values[key] != current.get(key) for key in values.keys() & {"title", "course_id", "context"}
            ):
                values.update(outdated_notes(current))
                values["relevance"] = None
            if "course_id" in values and values["course_id"] != current.get("course_id"):
                values["selected_resource_ids"] = []
            return public_lecture(repo.update("lectures", lecture_id, values))

    @app.delete("/api/lectures/{lecture_id}", status_code=204)
    def delete_lecture(lecture_id: str):
        with manager.lock:
            editable(lecture_id)
            for job in repo.list("jobs"):
                if job["lecture_id"] == lecture_id:
                    repo.delete("jobs", job["id"])
            repo.delete_chunks(lecture_id)
            repo.delete("lectures", lecture_id)
            shutil.rmtree(settings.lecture_dir(lecture_id), ignore_errors=True)

    @app.put("/api/lectures/{lecture_id}/transcript")
    def put_transcript(lecture_id: str, body: TranscriptInput):
        with manager.lock:
            current = editable(lecture_id)
            transcript = body.model_dump()
            (settings.lecture_dir(lecture_id) / "transcript.json").unlink(missing_ok=True)
            return public_lecture(
                repo.update(
                    "lectures",
                    lecture_id,
                    {
                        "transcript": transcript,
                        "duration": body.duration,
                        "language": body.language,
                        **(outdated_notes(current) if transcript != current.get("transcript") else {}),
                        "error": None,
                        "transcript_edited": True,
                        "relevance": None,
                        "relevance_overrides": {},
                    },
                )
            )

    @app.post("/api/lectures/{lecture_id}/process")
    def process_lecture(lecture_id: str, body: ProcessInput):
        value = get_lecture(lecture_id)
        if value["status"] == "recording":
            raise HTTPException(409, "Finish recording before generating notes")
        if not body.transcribe_only:
            try:
                generation_inputs(repo, value)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
        diarize = settings.diarization if body.diarize is None else body.diarize
        if not value.get("media_path") and repo.list_chunks(lecture_id):
            return manager.enqueue(
                lecture_id, body.force, diarize, live_finish=True, transcribe_only=body.transcribe_only
            )
        if not value.get("media_path") and not value.get("transcript"):
            raise HTTPException(422, "Add a recording or transcript first")
        return manager.enqueue(lecture_id, body.force, diarize, transcribe_only=body.transcribe_only)

    @app.post("/api/lectures/{lecture_id}/cancel")
    def cancel_lecture(lecture_id: str):
        get_lecture(lecture_id)
        return manager.cancel(lecture_id) or {"status": "cancelled"}

    @app.get("/api/lectures/{lecture_id}/media")
    def media(lecture_id: str):
        value = get_lecture(lecture_id)
        if not value.get("media_path") or not Path(value["media_path"]).is_file():
            raise HTTPException(404, "This lecture has no saved recording")
        return FileResponse(value["media_path"], media_type=value["media_type"])

    @app.get("/api/lectures/{lecture_id}/notes")
    def notes(lecture_id: str):
        value = get_lecture(lecture_id)
        if not value.get("notes"):
            raise HTTPException(404, "Notes are not ready")
        return value["notes"]

    @app.put("/api/lectures/{lecture_id}/notes")
    def put_notes(lecture_id: str, body: NoteInput):
        get_lecture(lecture_id)
        return public_lecture(repo.update("lectures", lecture_id, body.model_dump()))

    @app.post("/api/lectures/{lecture_id}/attachments", status_code=201)
    async def attach(lecture_id: str, file: UploadFile = File()):
        from starlette.concurrency import run_in_threadpool

        from .enrichment import extract_context

        editable(lecture_id)
        name = Path((file.filename or "material").replace("\\", "/")).name
        suffix = Path(name).suffix.lower()
        if suffix not in MATERIALS:
            raise HTTPException(415, "Choose a PDF, text file, or image")
        identifier = str(uuid4())
        folder = settings.lecture_dir(lecture_id) / "attachments"
        folder.mkdir(exist_ok=True)
        path = folder / (identifier + suffix)
        await save_upload(file, path, 30 * 1024**2)
        error, text = None, ""
        try:
            text = await run_in_threadpool(extract_context, path)
            if len(text) > 100000:
                text = text[:100000]
                error = "Only the first 100,000 characters are used as context"
        except (RuntimeError, ValueError, OSError) as exc:
            error = str(exc)[:1000]
        item = {
            "id": identifier,
            "name": name,
            "kind": suffix.lstrip("."),
            "text": text,
            "path": str(path),
            "url": f"/api/lectures/{lecture_id}/attachments/{identifier}",
            "created_at": now(),
            "error": error,
        }
        with manager.lock:
            try:
                value = editable(lecture_id)
            except HTTPException:
                path.unlink(missing_ok=True)
                raise
            repo.update(
                "lectures",
                lecture_id,
                {"attachments": value["attachments"] + [item], **outdated_notes(value)},
            )
        return {k: v for k, v in item.items() if k != "path"}

    def get_attachment(lecture_id, attachment_id):
        value = get_lecture(lecture_id)
        item = next((a for a in value["attachments"] if a["id"] == attachment_id), None)
        if not item:
            raise HTTPException(404, "Material not found")
        return value, item

    @app.get("/api/lectures/{lecture_id}/attachments/{attachment_id}")
    def attachment(lecture_id: str, attachment_id: str):
        _, item = get_attachment(lecture_id, attachment_id)
        return FileResponse(item["path"], filename=item["name"], content_disposition_type="inline")

    @app.delete("/api/lectures/{lecture_id}/attachments/{attachment_id}", status_code=204)
    def delete_attachment(lecture_id: str, attachment_id: str):
        with manager.lock:
            editable(lecture_id)
            value, item = get_attachment(lecture_id, attachment_id)
            repo.update(
                "lectures",
                lecture_id,
                {
                    "attachments": [a for a in value["attachments"] if a["id"] != attachment_id],
                    **outdated_notes(value),
                },
            )
            Path(item["path"]).unlink(missing_ok=True)

    @app.get("/api/lectures/{lecture_id}/assets/{filename}")
    def asset(lecture_id: str, filename: str):
        get_lecture(lecture_id)
        if Path(filename).name != filename or Path(filename).suffix.lower() not in {".png", ".jpg", ".webp"}:
            raise HTTPException(404, "Image not found")
        folder = settings.lecture_dir(lecture_id)
        for candidate in (folder / "images" / filename, folder / "assets" / filename, folder / filename):
            if candidate.is_file() and candidate.resolve().is_relative_to(folder):
                return FileResponse(candidate)
        raise HTTPException(404, "Image not found")

    @app.get("/api/lectures/{lecture_id}/export/{format}")
    def export(lecture_id: str, format: str):
        from .exports import export_notes

        if format not in {"md", "html", "pdf", "json"}:
            raise HTTPException(404, "Unknown export format")
        value = public_lecture(get_lecture(lecture_id))
        if not value.get("notes") and format != "json":
            raise HTTPException(409, "Generate notes before exporting")
        path = export_notes(value, format, settings.lecture_dir(lecture_id) / "exports")
        return FileResponse(path, filename=f"lecnote-{lecture_id[:8]}.{format}")

    @app.get("/api/jobs")
    def jobs():
        return repo.list("jobs")[:100]

    @app.get("/api/search")
    def search(q: str = "", course_id: str = ""):
        needle = q.strip().casefold()
        if not needle:
            return []
        results = []
        for item in repo.list("lectures"):
            if course_id and item.get("course_id") != course_id:
                continue
            lecture = public_lecture(item)
            base = {"lecture_id": item["id"], "title": item["title"], "course_name": lecture["course_name"]}
            if needle in item["title"].casefold():
                results.append({**base, "snippet": item["title"], "timestamp": None, "kind": "title"})
            for segment in (lecture.get("transcript") or {}).get("segments", []):
                if needle in segment["text"].casefold():
                    results.append(
                        {
                            **base,
                            "snippet": segment["text"][:500],
                            "timestamp": segment["start"],
                            "kind": "transcript",
                        }
                    )
            notes = item.get("notes") or {}
            texts = [(notes.get("overview", ""), None), (item.get("user_notes", ""), None)]
            texts += [(c.get("summary", ""), c.get("start")) for c in notes.get("chunks", [])]
            texts += [
                (p.get("text", ""), p.get("timestamp"))
                for c in notes.get("chunks", [])
                for p in c.get("key_points", [])
            ]
            for text, timestamp in texts:
                if needle in text.casefold():
                    results.append({**base, "snippet": text[:500], "timestamp": timestamp, "kind": "notes"})
            if len(results) >= 100:
                break
        return results[:100]

    @app.get("/api/glossary")
    def glossary(course_id: str = ""):
        result = []
        for lecture in repo.list("lectures"):
            if course_id and lecture.get("course_id") != course_id:
                continue
            for term in (lecture.get("notes") or {}).get("glossary", []):
                result.append({**term, "lecture_id": lecture["id"], "lecture_title": lecture["title"]})
        return sorted(result, key=lambda x: x["term"].casefold())

    @app.get("/api/settings")
    def get_settings():
        return settings.public()

    @app.put("/api/settings")
    def put_settings(body: SettingsInput):
        with manager.lock:
            new = replace(settings, **body.model_dump(exclude_unset=True, exclude_none=True))
            new.save()
            for name, value in vars(new).items():
                setattr(settings, name, value)
        return settings.public()

    @app.post("/api/settings/check")
    def check_settings():
        return {
            "ok": bool(settings.api_key),
            "message": "API key saved. It will be checked by OpenAI when notes are generated."
            if settings.api_key
            else "Add an OpenAI API key to generate notes. Local transcription remains available.",
        }

    @app.post("/api/live", status_code=201)
    def live(body: LiveInput):
        if any(item["status"] == "recording" for item in repo.list("lectures")):
            raise HTTPException(409, "Finish the current recording first")
        item = new_lecture(
            body.title, body.course_id, status="recording", language=body.language, context=body.context
        )
        return {"id": item["id"], "lecture_id": item["id"]}

    @app.post("/api/live/{lecture_id}/chunks")
    async def live_chunk(
        lecture_id: str, file: UploadFile = File(), sequence: int = Form(), offset: float = Form()
    ):
        get_lecture(lecture_id)
        if sequence < 0 or not math.isfinite(offset) or offset < 0:
            raise HTTPException(422, "Invalid recording sequence or offset")
        folder = settings.lecture_dir(lecture_id) / "live"
        folder.mkdir(exist_ok=True)
        temporary = folder / f"{uuid4()}.wav"
        await save_upload(file, temporary, 16 * 1024**2)
        try:
            try:
                with wave.open(str(temporary), "rb") as wav:
                    if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getnframes() == 0:
                        raise ValueError("Expected nonempty mono PCM16 WAV")
                    duration = wav.getnframes() / wav.getframerate()
                    rate = wav.getframerate()
                    if not 8000 <= rate <= 96000 or duration > 120:
                        raise ValueError("Unsupported recording chunk rate or duration")
                    if len(wav.readframes(wav.getnframes())) != wav.getnframes() * 2:
                        raise ValueError("Truncated audio chunk")
            except (wave.Error, EOFError, ValueError) as exc:
                raise HTTPException(422, str(exc)) from exc
            digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
            with manager.lock:
                lecture = get_lecture(lecture_id)
                chunks = repo.list_chunks(lecture_id)
                existing = next((c for c in chunks if c["sequence"] == sequence), None)
                if existing:
                    if existing["digest"] != digest or abs(existing["offset"] - offset) > 0.001:
                        raise HTTPException(409, "This chunk number contains different audio")
                    return {"accepted": True}
                if lecture["status"] != "recording":
                    raise HTTPException(409, "Recording is already finished")
                expected_offset = sum(c["duration"] for c in chunks)
                if sequence != len(chunks) or abs(offset - expected_offset) > 0.1:
                    raise HTTPException(409, "Upload recording chunks in order with continuous offsets")
                if chunks and chunks[0]["rate"] != rate:
                    raise HTTPException(422, "Recording sample rate changed")
                destination = folder / f"{sequence:06d}.wav"
                temporary.replace(destination)
                repo.add_chunk(
                    lecture_id,
                    sequence,
                    {
                        "sequence": sequence,
                        "offset": offset,
                        "duration": duration,
                        "rate": rate,
                        "digest": digest,
                        "path": str(destination),
                        "status": "queued",
                    },
                )
                manager.queue_chunk(lecture_id, sequence)
            return {"accepted": True}
        finally:
            temporary.unlink(missing_ok=True)

    @app.post("/api/live/{lecture_id}/finish")
    def finish_live(lecture_id: str):
        with manager.lock:
            lecture = get_lecture(lecture_id)
            if lecture["status"] not in {"recording", "interrupted"}:
                return public_lecture(lecture)
            chunks = repo.list_chunks(lecture_id)
            if not chunks:
                repo.update("lectures", lecture_id, {"status": "draft", "error": "No audio was recorded"})
                raise HTTPException(422, "No audio was recorded")
            manager.enqueue(
                lecture_id,
                diarize=settings.diarization,
                live_finish=True,
                transcribe_only=True,
            )
            return public_lecture(get_lecture(lecture_id))

    install_resources(app, repo, settings, manager, check_course, editable, public_lecture, save_upload)

    web = Path(__file__).resolve().parent.parent / "web" / "dist"
    if (web / "assets").exists():
        app.mount("/assets", StaticFiles(directory=web / "assets"), name="web-assets")

    @app.get("/{path:path}")
    def frontend(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Endpoint not found")
        if (web / "index.html").exists():
            return FileResponse(web / "index.html", headers={"Cache-Control": "no-store"})
        return Response(
            "LecNote API is running. Build the Web UI with npm run build in web/.",
            media_type="text/plain",
            headers={"Cache-Control": "no-store"},
        )

    return app

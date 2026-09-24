import logging
import queue
import threading
from dataclasses import replace
from pathlib import Path

from .locking import LibraryLock
from .schemas import Notes

log = logging.getLogger(__name__)
ACTIVE = {"queued", "running"}


class JobManager:
    def __init__(self, repo, settings, pipeline=None, start_worker=True):
        self.library_lock = LibraryLock(settings.data_dir / "worker.lock")
        self.repo = repo
        self.settings = settings
        self.pipeline = pipeline
        self.lock = threading.RLock()
        self.work = queue.Queue()
        self.stopped = threading.Event()
        self.cancelled = set()
        self.thread = None
        for job in repo.list("jobs"):
            if job["status"] in ACTIVE:
                repo.update(
                    "jobs",
                    job["id"],
                    {"status": "interrupted", "message": "App restarted. Resume when ready."},
                )
                if repo.get("lectures", job["lecture_id"]):
                    repo.update("lectures", job["lecture_id"], {"status": "interrupted"})
        for lecture in repo.list("lectures"):
            if not lecture.get("notes"):
                saved = settings.data_dir / "lectures" / lecture["id"] / "notes.json"
                try:
                    notes = Notes.model_validate_json(saved.read_text()).model_dump()
                except (OSError, ValueError):
                    pass
                else:
                    # Repair older versions that cleared the database copy on edits.
                    values = {"notes": notes, "notes_stale": True}
                    if lecture["status"] == "draft":
                        values["status"] = "ready"
                    repo.update("lectures", lecture["id"], values)
            if lecture["status"] == "recording":
                repo.update(
                    "lectures",
                    lecture["id"],
                    {
                        "status": "interrupted",
                        "error": "Recording interrupted. Saved audio chunks are preserved.",
                    },
                )
        if start_worker:
            self.thread = threading.Thread(target=self._loop, name="lecnote-worker", daemon=True)
            self.thread.start()

    def latest(self, lecture_id):
        return next((job for job in self.repo.list("jobs") if job["lecture_id"] == lecture_id), None)

    def active(self, lecture_id):
        job = self.latest(lecture_id)
        return job if job and job["status"] in ACTIVE else None

    def enqueue(self, lecture_id, force=False, diarize=False, live_finish=False, transcribe_only=False):
        with self.lock:
            active = self.active(lecture_id)
            if active:
                return active
            job = self.repo.create(
                "jobs",
                {
                    "lecture_id": lecture_id,
                    "status": "queued",
                    "stage": "queued",
                    "progress": 0,
                    "message": "Waiting to process",
                    "error": None,
                    "force": force,
                    "diarize": diarize,
                    "live_finish": live_finish,
                    "transcribe_only": transcribe_only,
                },
            )
            self.repo.update("lectures", lecture_id, {"status": "queued", "error": None})
            self.work.put(("pipeline", job["id"]))
            return job

    def cancel(self, lecture_id):
        with self.lock:
            job = self.active(lecture_id)
            if not job:
                lecture = self.repo.get("lectures", lecture_id)
                if lecture and lecture["status"] == "recording":
                    self.repo.update(
                        "lectures",
                        lecture_id,
                        {"status": "cancelled", "live_epoch": lecture.get("live_epoch", 0) + 1},
                    )
                    return {"status": "cancelled"}
                return self.latest(lecture_id)
            self.cancelled.add(job["id"])
            lecture = self.repo.get("lectures", lecture_id)
            self.repo.update("lectures", lecture_id, {"live_epoch": lecture.get("live_epoch", 0) + 1})
            if job["status"] == "queued":
                self.repo.update("lectures", lecture_id, {"status": "cancelled"})
                return self.repo.update("jobs", job["id"], {"status": "cancelled", "message": "Cancelled"})
            return self.repo.update("jobs", job["id"], {"message": "Cancelling after the current operation"})

    def queue_chunk(self, lecture_id, sequence):
        lecture = self.repo.get("lectures", lecture_id)
        self.work.put(("live", (lecture_id, sequence, lecture.get("live_epoch", 0))))

    def _loop(self):
        try:
            self._process_queue()
        finally:
            self.library_lock.close()

    def _process_queue(self):
        while not self.stopped.is_set():
            try:
                kind, identifier = self.work.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                if kind == "pipeline":
                    self._run(identifier)
                else:
                    self._live(*identifier)
            except Exception:
                # Individual jobs handle provider details; never log credentials.
                log.error("A worker operation failed; its saved source remains available.")
            finally:
                self.work.task_done()

    def _redact(self, error):
        message = str(error)[:1500]
        for secret in (self.settings.api_key, self.settings.hf_token):
            if secret:
                message = message.replace(secret, "[redacted]")
        return message

    def _run(self, job_id):
        from .pipeline import PipelineCancelled, run_pipeline

        with self.lock:
            job = self.repo.get("jobs", job_id)
            if not job or job["status"] != "queued":
                return
            self.repo.update("jobs", job_id, {"status": "running", "stage": "starting"})
        lecture_id = job["lecture_id"]
        settings = replace(self.settings)

        def cancelled():
            return job_id in self.cancelled or self.stopped.is_set()

        def progress(stage, percent, message):
            if cancelled():
                raise PipelineCancelled("Cancelled")
            self.repo.update("jobs", job_id, {"stage": stage, "progress": percent, "message": message})
            status = "transcribing" if stage in {"transcribing", "diarizing"} else "generating"
            self.repo.update("lectures", lecture_id, {"status": status})

        try:
            lecture = self.repo.get("lectures", lecture_id)
            if job.get("live_finish"):
                from .enrichment import assemble_wav

                chunks = self.repo.list_chunks(lecture_id)
                destination = settings.lecture_dir(lecture_id) / "recording.wav"
                assemble_wav([Path(chunk["path"]) for chunk in chunks], destination)
                values = {
                    "media_path": str(destination),
                    "source_name": "recording.wav",
                    "media_type": "audio/wav",
                }
                if not lecture.get("transcript_edited") and any(
                    chunk.get("status") != "completed" for chunk in chunks
                ):
                    values["transcript"] = None
                lecture = self.repo.update("lectures", lecture_id, values)
            course = self.repo.get("courses", lecture.get("course_id")) or {}
            if not job.get("transcribe_only"):
                from .resources import generation_inputs

                lecture = generation_inputs(self.repo, lecture)
            lecture.update(
                course_context=course.get("context", ""),
                vocabulary=course.get("vocabulary", ""),
                diarize=job.get("diarize", False),
                force=job.get("force", False),
                transcribe_only=job.get("transcribe_only", False),
            )
            def checkpoint(values):
                with self.lock:
                    if cancelled():
                        raise PipelineCancelled("Cancelled")
                    current = self.repo.get("lectures", lecture_id)
                    changes = dict(values)
                    if "transcript" in values:
                        changes["duration"] = values["transcript"]["duration"]
                        if current.get("transcript") != values["transcript"]:
                            changes.update(relevance=None, notes_stale=bool(current.get("notes")))
                    self.repo.update("lectures", lecture_id, changes)

            if self.pipeline:
                result = self.pipeline(lecture, settings, progress, cancelled)
            else:
                result = run_pipeline(lecture, settings, progress, cancelled, checkpoint=checkpoint)
            with self.lock:
                if cancelled():
                    raise PipelineCancelled("Cancelled")
                saved_notes = result["notes"] or lecture.get("notes")
                self.repo.update(
                    "lectures",
                    lecture_id,
                    {
                        "transcript": result["transcript"],
                        "notes": saved_notes,
                        "resource_provenance": lecture.get("resource_provenance", []),
                        "relevance": result.get("relevance", lecture.get("relevance")),
                        "notes_stale": False
                        if result["notes"]
                        else bool(saved_notes)
                        and (
                            lecture.get("notes_stale", False)
                            or result["transcript"] != lecture.get("transcript")
                        ),
                        "duration": result["transcript"].get("duration", 0),
                        "status": "ready" if saved_notes else "draft",
                        "error": None,
                    },
                )
                self.repo.update(
                    "jobs",
                    job_id,
                    {
                        "status": "completed",
                        "stage": "complete",
                        "progress": 100,
                        "message": "Notes are ready" if result["notes"] else "Transcript is ready",
                        "error": None,
                    },
                )
        except PipelineCancelled:
            status = "interrupted" if self.stopped.is_set() else "cancelled"
            self.repo.update("jobs", job_id, {"status": status, "message": status.capitalize()})
            self.repo.update("lectures", lecture_id, {"status": status})
        except Exception as exc:
            message = self._redact(exc)
            self.repo.update(
                "jobs",
                job_id,
                {
                    "status": "failed",
                    "error": message,
                    "message": "Processing stopped. Fix the issue and retry.",
                },
            )
            self.repo.update("lectures", lecture_id, {"status": "failed", "error": message})
        finally:
            self.cancelled.discard(job_id)

    def _live(self, lecture_id, sequence, epoch=None):
        from .transcription import transcribe

        lecture = self.repo.get("lectures", lecture_id)
        if not lecture:
            return
        epoch = lecture.get("live_epoch", 0) if epoch is None else epoch
        if lecture.get("live_epoch", 0) != epoch:
            return
        chunk = next((c for c in self.repo.list_chunks(lecture_id) if c["sequence"] == sequence), None)
        if not chunk or chunk.get("status") == "completed":
            return
        try:
            settings = replace(self.settings, language=lecture.get("language") or self.settings.language)
            course = self.repo.get("courses", lecture.get("course_id")) or {}
            transcript = transcribe(Path(chunk["path"]), settings, course.get("vocabulary", ""))
            shifted = [
                {**s, "start": s["start"] + chunk["offset"], "end": s["end"] + chunk["offset"]}
                for s in transcript["segments"]
            ]
            with self.lock:
                current = self.repo.get("lectures", lecture_id)
                if not current or current.get("live_epoch", 0) != epoch:
                    return
                self.repo.update_chunk(
                    lecture_id,
                    sequence,
                    {"status": "completed", "segments": shifted, "language": transcript["language"]},
                )
                all_chunks = self.repo.list_chunks(lecture_id)
                segments = [s for c in all_chunks for s in c.get("segments", [])]
                segments = [{**s, "id": i} for i, s in enumerate(segments)]
                duration = max(
                    [c["offset"] + c["duration"] for c in all_chunks]
                    + [segment["end"] for segment in segments],
                    default=0,
                )
                self.repo.update(
                    "lectures",
                    lecture_id,
                    {
                        "transcript": {
                            "language": transcript["language"],
                            "duration": duration,
                            "segments": segments,
                        },
                        "duration": duration,
                    },
                )
        except Exception as exc:
            with self.lock:
                current = self.repo.get("lectures", lecture_id)
                if not current or current.get("live_epoch", 0) != epoch:
                    return
                self.repo.update_chunk(lecture_id, sequence, {"status": "failed", "error": self._redact(exc)})
                self.repo.update(
                    "lectures", lecture_id, {"error": "Live transcription: " + self._redact(exc)}
                )

    def close(self):
        self.stopped.set()
        if self.thread:
            self.thread.join(timeout=3)
        else:
            self.library_lock.close()

"""Isolated media operations; importing this module performs no maintenance.

The caller MUST hold the manager lock for each complete public operation and
serialize recording/chunk writers, job scheduling and deletion with that lock.
Pass in-memory work through busy_ids/merge_input_ids. Repository status checks
are additional safeguards, not a substitute for serialization. No worker,
scheduler, Settings.load(), or process-wide lock is started here.

merge() creates a lecture only after its independent audio is verified. Source
lectures are never changed. Provenance lives in merge_sources/segment_sources,
outside the strict Transcript schema. If any source lacks a transcript, the
available text is retained as partial_transcript and transcript remains None so
the worker can transcribe the complete merged recording.

mark_finalized() must be called after a saved upload or final live WAV assembly,
not on recording start/stop alone. Existing dates are never inferred or reset.
Compression publishes a unique .m4a atomically, commits the new database pointer,
then removes unreferenced originals/chunks. A crash can leave extra files, never
a database pointer to a half-written replacement. Chunk transcript records stay.
"""

import json
import math
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from .schemas import MAX_TRANSCRIPT_CHARACTERS, PipelineCancelled, Transcript

BUSY_STATUSES = {
    "recording",
    "queued",
    "running",
    "processing",
    "transcribing",
    "generating",
    "merging",
    "compressing",
    "finalizing",
}
ACTIVE_JOBS = {"queued", "running"}
COMPRESSION_DELAY = timedelta(hours=6)
MAX_COMPRESSION_ATTEMPTS = 5


class MediaError(ValueError):
    """Invalid, missing, excessive, or unverifiable media; safe to show to users."""


class MediaBusy(MediaError):
    """A requested input is in use; retry after the owner releases it."""


@dataclass(frozen=True)
class MediaLimits:
    max_inputs: int = 20
    max_duration_seconds: float = 21_600
    max_source_bytes: int = 4 * 1024**3
    max_output_bytes: int = 1024**3
    max_transcript_characters: int = MAX_TRANSCRIPT_CHARACTERS
    max_segments: int = 30_000
    command_timeout_seconds: float = 3600

    def __post_init__(self):
        if any(not math.isfinite(value) or value <= 0 for value in vars(self).values()):
            raise ValueError("Media limits must be finite and positive")


def _date(value=None):
    if value is None:
        return datetime.now(timezone.utc)
    result = datetime.fromisoformat(value) if isinstance(value, str) else value
    if not isinstance(result, datetime) or result.tzinfo is None:
        raise MediaError("Media timestamps must include a timezone")
    return result.astimezone(timezone.utc)


def _cancel(cancelled):
    if cancelled and cancelled():
        raise PipelineCancelled("Media operation cancelled")


def _tolerance(duration):
    return max(0.25, min(1.0, duration * 0.0001))


def _fingerprint(path):
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


def transcript_provenance(lecture, transcript):
    """Attribute new segmentation by audio ranges, never by recycled segment IDs.

    Multiple rows may share segment_id when text spans source boundaries. Nested
    merge_sources snapshots retain root ranges even after an input is deleted.
    No source_segment_id is asserted for newly transcribed or edited segments.
    """
    if not lecture.get("merge_sources") or transcript == lecture.get("transcript"):
        return {}

    def overlaps(sources, start, end):
        for source in sources:
            offset = source["offset"]
            left = max(start, offset) - offset
            right = min(end, offset + source["duration"]) - offset
            if right <= left:
                continue
            if source.get("merge_sources"):
                yield from overlaps(source["merge_sources"], left, right)
            else:
                yield {
                    "source_lecture_id": source["lecture_id"],
                    "source_start": left,
                    "source_end": right,
                }

    return {
        "partial_transcript": None,
        "segment_sources": [
            {"segment_id": segment["id"], **origin}
            for segment in transcript["segments"]
            for origin in overlaps(lecture["merge_sources"], segment["start"], segment["end"])
        ],
    }


class MediaService:
    def __init__(self, repo, settings, *, limits=None):
        self.repo = repo
        self.settings = settings
        self.limits = limits or MediaLimits()

    def _lecture(self, lecture_id):
        item = self.repo.get("lectures", lecture_id)
        if item is None:
            raise MediaError("Recording not found")
        return item

    def _folder(self, lecture_id):
        root = (self.settings.data_dir / "lectures").resolve()
        path = root / str(lecture_id)
        if path.is_symlink() or path.resolve().parent != root:
            raise MediaError("Invalid lecture directory")
        return path

    def _source(self, lecture):
        raw = lecture.get("media_path")
        if not raw:
            raise MediaError("This lecture has no finalized recording")
        path = Path(raw)
        folder = self._folder(lecture["id"])
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(folder.resolve()):
            raise MediaError("Recording must be a regular file in its lecture directory")
        if not 0 < path.stat().st_size <= self.limits.max_source_bytes:
            raise MediaError("Recording exceeds the media byte limit or is empty")
        if any(
            c.get("path") and Path(c["path"]).resolve() == path.resolve()
            for c in self.repo.list_chunks(lecture["id"])
        ):
            raise MediaError("A live chunk is not a finalized recording")
        return path.resolve()

    def _busy(self, lecture, busy_ids=(), job_id=None):
        identifier = lecture["id"]
        if identifier in busy_ids or lecture.get("status") in BUSY_STATUSES:
            return True
        if any(c.get("status") in ACTIVE_JOBS for c in self.repo.list_chunks(identifier)):
            return True
        for job in self.repo.list("jobs"):
            if job["id"] == job_id or job.get("status") not in ACTIVE_JOBS:
                continue
            inputs = set()
            for key in ("source_lecture_ids", "lecture_ids", "merge_input_ids"):
                inputs.update(job.get(key) or ())
            if job.get("lecture_id") == identifier or identifier in inputs:
                return True
        return False

    def _run(self, command, *, cancelled=None):
        _cancel(cancelled)
        started = time.monotonic()
        try:
            # FFmpeg diagnostics can be unbounded on damaged input. Never expose
            # their file paths or arbitrary source metadata in persisted errors.
            with tempfile.TemporaryFile() as errors:
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors)
                try:
                    while True:
                        _cancel(cancelled)
                        if time.monotonic() - started > self.limits.command_timeout_seconds:
                            raise MediaError("Media processing timed out")
                        try:
                            output, _ = process.communicate(timeout=0.2)
                            break
                        except subprocess.TimeoutExpired:
                            continue
                    if process.returncode:
                        raise MediaError("FFmpeg could not fully process this recording")
                    return output.decode("utf-8", errors="replace")
                finally:
                    if process.poll() is None:
                        process.kill()
                    process.wait()
        except FileNotFoundError as exc:
            raise MediaError("FFmpeg and ffprobe are required for media operations") from exc

    def _probe(self, path, *, cancelled=None):
        try:
            data = json.loads(
                self._run(
                    [
                        "ffprobe",
                        "-v",
                        "error",
                        "-show_entries",
                        "stream=codec_type,duration:format=duration",
                        "-of",
                        "json",
                        str(path),
                    ],
                    cancelled=cancelled,
                )
            )
            streams = data.get("streams", [])
            audio = next(s for s in streams if s.get("codec_type") == "audio")
            duration = float(audio.get("duration") or data.get("format", {}).get("duration"))
        except (ValueError, TypeError, StopIteration, KeyError) as exc:
            raise MediaError("Recording has no measurable audio stream") from exc
        if not math.isfinite(duration) or not 0 < duration <= self.limits.max_duration_seconds:
            raise MediaError("Recording exceeds the duration limit or has no audio")
        return duration, any(s.get("codec_type") == "video" for s in streams)

    def _validate(self, path, expected=None, *, cancelled=None):
        measured, _ = self._probe(path, cancelled=cancelled)
        output = self._run(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-xerror",
                "-err_detect",
                "explode",
                "-i",
                str(path),
                "-map",
                "0:a:0",
                "-vn",
                "-af",
                "asetpts=N/SR/TB",
                "-ar",
                "24000",
                "-ac",
                "1",
                "-progress",
                "pipe:1",
                "-f",
                "null",
                "-",
            ],
            cancelled=cancelled,
        )
        times = [
            float(line.split("=", 1)[1]) / 1_000_000
            for line in output.splitlines()
            if line.startswith("out_time_us=")
        ]
        decoded = max(times, default=0)
        if not math.isfinite(decoded) or decoded <= 0 or abs(decoded - measured) > _tolerance(measured):
            raise MediaError("Decoded audio duration does not match the recording")
        if expected is not None and (
            abs(decoded - expected) > _tolerance(expected) or abs(measured - expected) > _tolerance(expected)
        ):
            raise MediaError("Replacement duration does not match the original audio")
        return decoded

    def _encode(self, paths, target, *, cancelled=None):
        command = ["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-y"]
        for path in paths:
            command.extend(["-err_detect", "explode", "-i", str(path)])
        filters = [
            f"[{i}:a:0]aresample=24000,aformat=channel_layouts=mono,asetpts=N/SR/TB[a{i}]"
            for i in range(len(paths))
        ]
        filters.append("".join(f"[a{i}]" for i in range(len(paths))) + f"concat=n={len(paths)}:v=0:a=1[out]")
        command.extend(
            [
                "-filter_complex",
                ";".join(filters),
                "-map",
                "[out]",
                "-vn",
                "-map_metadata",
                "-1",
                "-c:a",
                "aac",
                "-b:a",
                "48k",
                "-ar",
                "24000",
                "-ac",
                "1",
                "-movflags",
                "+faststart",
                str(target),
            ]
        )
        self._run(command, cancelled=cancelled)
        if not target.is_file() or not 0 < target.stat().st_size <= self.limits.max_output_bytes:
            raise MediaError("Encoded recording exceeds the output byte limit or is empty")

    def mark_finalized(self, lecture_id, *, finalized_at=None):
        """Persist eligibility after final audio exists; idempotent, no transcoding.

        Caller may be finalizing an active pipeline job, but recording must have
        stopped and the final file must no longer be writable by a recorder.
        """
        lecture = self._lecture(lecture_id)
        if lecture.get("status") == "recording":
            raise MediaBusy("Stop the recording before marking its audio finalized")
        self._source(lecture)
        if lecture.get("finalized_at"):
            return lecture
        timestamp = _date(finalized_at)
        return self.repo.update(
            "lectures",
            lecture_id,
            {
                "finalized_at": timestamp.isoformat(),
                "compression": {
                    "status": "pending",
                    "attempts": 0,
                    "eligible_at": (timestamp + COMPRESSION_DELAY).isoformat(),
                },
            },
        )

    def merge(self, lecture_ids, *, title=None, busy_ids=(), job_id=None, cancelled=None):
        """Merge ordered, distinct same-course recordings without modifying inputs.

        Raises MediaBusy for ANY active recording or busy input (never silently
        drops a requested source), MediaError for invalid media/limits, PipelineCancelled if the
        optional zero-argument callback returns True. job_id excludes only the
        caller's own queued/running job. No destination placeholder is required.
        """
        ids = list(lecture_ids)
        if not 2 <= len(ids) <= self.limits.max_inputs or len(set(ids)) != len(ids):
            raise MediaError("Choose two or more distinct recordings within the input limit")
        if title is not None and (not isinstance(title, str) or not title.strip() or len(title) > 500):
            raise MediaError("Merged recording title must contain 1 to 500 characters")
        _cancel(cancelled)
        if any(item.get("status") == "recording" for item in self.repo.list("lectures")):
            raise MediaBusy("Stop all active recordings before merging")
        lectures = [self._lecture(identifier) for identifier in ids]
        course = lectures[0].get("course_id")
        if not course or any(item.get("course_id") != course for item in lectures):
            raise MediaError("Merged recordings must belong to the same class")
        if any(self._busy(item, busy_ids, job_id) for item in lectures):
            raise MediaBusy("A selected recording is busy; wait before merging")
        paths = [self._source(item) for item in lectures]
        fingerprints = [_fingerprint(path) for path in paths]
        if sum(path.stat().st_size for path in paths) > self.limits.max_source_bytes:
            raise MediaError("Combined recordings exceed the source byte limit")
        transcripts = []
        try:
            for item in lectures:
                available = item.get("transcript") or item.get("partial_transcript")
                transcripts.append(
                    Transcript.model_validate(available).model_dump() if available is not None else None
                )
        except ValueError as exc:
            raise MediaError("A source transcript is invalid") from exc
        segments_count = sum(len(t["segments"]) for t in transcripts if t)
        characters = sum(len(s["text"]) for t in transcripts if t for s in t["segments"])
        if segments_count > self.limits.max_segments or characters > self.limits.max_transcript_characters:
            raise MediaError("Combined transcript exceeds the transcript limit")
        durations = [self._validate(path, cancelled=cancelled) for path in paths]
        duration = sum(durations)
        if duration > self.limits.max_duration_seconds:
            raise MediaError("Combined recordings exceed the duration limit")
        segments, segment_sources, merge_sources = [], [], []
        offset = 0.0
        for item, transcript, length in zip(lectures, transcripts, durations):
            if transcript and transcript["duration"] > length + _tolerance(length):
                raise MediaError("A source transcript extends beyond its audio")
            merge_sources.append(
                {
                    "lecture_id": item["id"],
                    "title": item.get("title", ""),
                    "source_name": item.get("source_name", ""),
                    "offset": offset,
                    "duration": length,
                    "transcript_available": item.get("transcript") is not None,
                    **({"merge_sources": item["merge_sources"]} if item.get("merge_sources") else {}),
                }
            )
            prior = {}
            for source in item.get("segment_sources", []):
                prior.setdefault(source["segment_id"], []).append(source)
            if item.get("merge_sources") and not prior and transcript:
                for source in transcript_provenance({**item, "transcript": None}, transcript)["segment_sources"]:
                    prior.setdefault(source["segment_id"], []).append(source)
            for segment in (transcript or {}).get("segments", []):
                identifier = len(segments)
                segments.append(
                    {
                        **segment,
                        "id": identifier,
                        "start": offset + min(segment["start"], length),
                        "end": offset + min(segment["end"], length),
                    }
                )
                origins = prior.get(segment["id"], []) if item.get("merge_sources") else [{
                    "source_lecture_id": item["id"],
                    "source_segment_id": segment["id"],
                    "source_start": segment["start"],
                    "source_end": segment["end"],
                }]
                for origin in origins:
                    segment_sources.append({
                        **origin,
                        "segment_id": identifier,
                        "input_lecture_id": item["id"],
                        "input_segment_id": segment["id"],
                    })
            offset += length
        languages = {t["language"] for t in transcripts if t}
        combined = Transcript(
            language=next(iter(languages)) if len(languages) == 1 else "unknown",
            duration=duration,
            segments=segments,
        ).model_dump()
        # Transcript labels may be descriptive; inference requires a Whisper code.
        from faster_whisper.tokenizer import _LANGUAGE_CODES

        hints = languages | {item.get("language", "") for item in lectures}
        supported_hints = hints.intersection(_LANGUAGE_CODES)
        language = next(iter(supported_hints)) if len(supported_hints) == 1 else ""
        complete = all(item.get("transcript") is not None for item in lectures)
        identifier = str(uuid4())
        folder = self._folder(identifier)
        folder.mkdir(parents=True, exist_ok=False)
        target = folder / "recording.m4a"
        published = False
        try:
            with tempfile.TemporaryDirectory(prefix=".merge-", dir=folder) as scratch:
                temporary = Path(scratch) / "recording.m4a"
                self._encode(paths, temporary, cancelled=cancelled)
                self._validate(temporary, duration, cancelled=cancelled)
                _cancel(cancelled)
                if any(
                    self._lecture(item["id"]) != item or self._busy(item, busy_ids, job_id)
                    for item in lectures
                ) or any(_fingerprint(path) != stamp for path, stamp in zip(paths, fingerprints)):
                    raise MediaBusy("A source recording changed during the merge")
                self._publish(temporary, target)
                timestamp = _date()
                result = self.repo.create(
                    "lectures",
                    {
                        "id": identifier,
                        "title": (title or "Merged recording").strip(),
                        "course_id": course,
                        "status": "draft",
                        "source_name": target.name,
                        "media_type": "audio/mp4",
                        "media_path": str(target),
                        "duration": duration,
                        "language": language,
                        "transcript": combined if complete else None,
                        "partial_transcript": None if complete else combined,
                        "merge_sources": merge_sources,
                        "segment_sources": segment_sources,
                        "notes": None,
                        "notes_stale": False,
                        "user_notes": "",
                        "context": "",
                        "attachments": [],
                        "error": None,
                        "finalized_at": timestamp.isoformat(),
                        "compression": {
                            "status": "pending",
                            "attempts": 0,
                            "eligible_at": (timestamp + COMPRESSION_DELAY).isoformat(),
                        },
                    },
                )
                published = True
                return result
        finally:
            if not published:
                target.unlink(missing_ok=True)
                folder.rmdir()

    @staticmethod
    def _publish(temporary, target):
        with temporary.open("rb") as handle:
            os.fsync(handle.fileno())
        os.replace(temporary, target)
        descriptor = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _enabled(self, lecture):
        course = self.repo.get("courses", lecture.get("course_id")) or {}
        enabled = getattr(self.settings, "optimize_recordings", True)
        if course.get("optimize_recordings") is not None:
            enabled = course["optimize_recordings"]
        if lecture.get("optimize_recordings") is not None:
            enabled = lecture["optimize_recordings"]
        return bool(enabled)

    def _referenced_elsewhere(self, path, lecture_id):
        for item in self.repo.list("lectures"):
            if item["id"] == lecture_id:
                continue
            references = [item.get("media_path")]
            references.extend(c.get("path") for c in self.repo.list_chunks(item["id"]))
            if any(value and Path(value).resolve() == path.resolve() for value in references):
                return True
        return False

    def _ineligible(self, lecture, timestamp, busy_ids):
        if not self._enabled(lecture):
            return "disabled"
        if self._busy(lecture, busy_ids):
            return "busy"
        if not lecture.get("finalized_at"):
            return "not_finalized"
        state = lecture.get("compression") or {}
        if timestamp < _date(lecture["finalized_at"]) + COMPRESSION_DELAY:
            return "not_due"
        if state.get("status") in {"compressed", "not_smaller", "video"}:
            return state["status"]
        if state.get("attempts", 0) >= MAX_COMPRESSION_ATTEMPTS:
            return "retry_exhausted"
        if state.get("next_attempt_at") and timestamp < _date(state["next_attempt_at"]):
            return "backoff"
        media_type = str(lecture.get("media_type", ""))
        if media_type.startswith("video/"):
            return "video"
        if not media_type.startswith("audio/"):
            return "not_audio"
        if lecture.get("media_path") and self._referenced_elsewhere(
            Path(lecture["media_path"]), lecture["id"]
        ):
            return "shared_source"
        return None

    def compression_candidates(self, *, now=None, busy_ids=(), merge_input_ids=(), limit=1):
        """Read-only eligible ID selection, at most limit; no FFmpeg or mutation.

        No candidates are returned while ANY recording is active. Call under
        the manager lock; compress() rechecks eligibility before it acts.
        """
        if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1:
            raise MediaError("Compression limit must be a positive integer")
        lectures = self.repo.list("lectures")
        if any(item.get("status") == "recording" for item in lectures):
            return []
        timestamp = _date(now)
        busy = set(busy_ids) | set(merge_input_ids)
        candidates = []
        for item in lectures:
            if self._ineligible(item, timestamp, busy) is None:
                candidates.append(item["id"])
                if len(candidates) == limit:
                    break
        return candidates

    def compress_due(self, *, now=None, busy_ids=(), merge_input_ids=(), limit=1, cancelled=None):
        """Run bounded per-file compression; caller schedules it in the worker.

        Never runs while any lecture is recording. Returns result dictionaries;
        skipped entries do not change metadata. Failures persist bounded backoff.
        """
        timestamp = _date(now)
        candidates = self.compression_candidates(
            now=timestamp, busy_ids=busy_ids, merge_input_ids=merge_input_ids, limit=limit
        )
        return [
            self.compress(
                identifier,
                now=timestamp,
                busy_ids=busy_ids,
                merge_input_ids=merge_input_ids,
                cancelled=cancelled,
            )
            for identifier in candidates
        ]

    def compress(self, lecture_id, *, now=None, busy_ids=(), merge_input_ids=(), cancelled=None):
        """Return {lecture_id, status, reason?}; preserve all originals on failure.

        Uses optimize_recordings on settings/course/lecture; None inherits.
        Failures retry after 5 minutes, doubling across restarts, at most 5 tries.
        Videos are retained: automatic audio optimization never discards video.
        Cancellation raises PipelineCancelled without consuming a retry attempt.
        """
        lecture = self._lecture(lecture_id)
        timestamp = _date(now)

        def skipped(reason):
            return {"lecture_id": lecture_id, "status": "skipped", "reason": reason}

        reason = self._ineligible(lecture, timestamp, set(busy_ids) | set(merge_input_ids))
        if reason:
            return skipped(reason)
        _cancel(cancelled)
        callbacks = {"cancelled": cancelled} if cancelled else {}
        state = lecture.get("compression") or {}
        published = None
        committed = False
        try:
            source = self._source(lecture)
            fingerprint = _fingerprint(source)
            if self._referenced_elsewhere(source, lecture_id):
                return skipped("shared_source")
            _, has_video = self._probe(source, **callbacks)
            if has_video:
                self.repo.update("lectures", lecture_id, {"compression": {**state, "status": "video"}})
                return skipped("video")
            duration = self._validate(source, **callbacks)
            original_bytes = source.stat().st_size
            with tempfile.TemporaryDirectory(prefix=".compress-", dir=source.parent) as scratch:
                temporary = Path(scratch) / "recording.m4a"
                self._encode([source], temporary, **callbacks)
                self._validate(temporary, duration, **callbacks)
                _cancel(cancelled)
                output_bytes = temporary.stat().st_size
                if (
                    self._lecture(lecture_id) != lecture
                    or _fingerprint(source) != fingerprint
                    or self._busy(lecture, set(busy_ids) | set(merge_input_ids))
                ):
                    return skipped("changed")
                if output_bytes >= original_bytes:
                    self.repo.update(
                        "lectures",
                        lecture_id,
                        {
                            "compression": {
                                **state,
                                "status": "not_smaller",
                                "checked_at": timestamp.isoformat(),
                                "next_attempt_at": None,
                            }
                        },
                    )
                    return skipped("not_smaller")
                published = source.parent / f"optimized-{uuid4().hex}.m4a"
                self._publish(temporary, published)
                self.repo.update(
                    "lectures",
                    lecture_id,
                    {
                        "media_path": str(published),
                        "media_type": "audio/mp4",
                        "source_name": published.name,
                        "compression": {
                            **state,
                            "status": "compressed",
                            "completed_at": timestamp.isoformat(),
                            "original_bytes": original_bytes,
                            "compressed_bytes": output_bytes,
                            "next_attempt_at": None,
                            "cleanup_pending": True,
                        },
                    },
                )
                committed = True
            # The verified replacement and DB pointer are durable before any
            # destructive step. Cleanup failure leaves a usable new recording.
            cleanup_complete = self._cleanup(lecture_id, source, published)
            updated = self._lecture(lecture_id)
            try:
                self.repo.update(
                    "lectures",
                    lecture_id,
                    {
                        "compression": {
                            **updated["compression"],
                            "cleanup_pending": not cleanup_complete,
                        }
                    },
                )
            except Exception:
                pass
            return {
                "lecture_id": lecture_id,
                "status": "compressed",
                "saved_bytes": original_bytes - output_bytes,
            }
        except PipelineCancelled:
            raise
        except Exception as exc:
            if committed:
                return {"lecture_id": lecture_id, "status": "compressed", "cleanup_pending": True}
            attempts = int(state.get("attempts", 0)) + 1
            retry = timestamp + timedelta(seconds=min(86400, 300 * 2 ** min(attempts - 1, 9)))
            # Do not replace newer state if a caller violated the lock contract.
            if self._lecture(lecture_id) == lecture:
                self.repo.update(
                    "lectures",
                    lecture_id,
                    {
                        "compression": {
                            **state,
                            "status": "failed",
                            "attempts": attempts,
                            "next_attempt_at": retry.isoformat(),
                            "error": "Media optimization failed; original retained.",
                        }
                    },
                )
            return {"lecture_id": lecture_id, "status": "failed", "reason": type(exc).__name__}
        finally:
            if published is not None and not committed:
                published.unlink(missing_ok=True)

    def _cleanup(self, lecture_id, source, replacement):
        complete = True
        folder = self._folder(lecture_id).resolve()
        for chunk in self.repo.list_chunks(lecture_id):
            raw = chunk.get("path")
            if not raw:
                continue
            path = Path(raw)
            if (
                path.is_symlink()
                or path.suffix.lower() != ".wav"
                or not path.resolve().is_relative_to(folder)
                or path.resolve() == replacement.resolve()
                or self._referenced_elsewhere(path, lecture_id)
            ):
                continue
            try:
                self.repo.update_chunk(lecture_id, chunk["sequence"], {"path": None, "audio_removed": True})
                path.unlink(missing_ok=True)
            except (OSError, KeyError):
                complete = False
        if not self._referenced_elsewhere(source, lecture_id):
            try:
                source.unlink(missing_ok=True)
            except OSError:
                complete = False
        return complete

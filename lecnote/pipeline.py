"""Resumable processing with content-addressed, complete-stage caches."""

import hashlib
import json
import math
import os
import tempfile
import uuid
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError

from . import notes as note_service
from .context import SupportingContext
from .schemas import (
    MAX_CHUNK_CHARACTERS,
    MAX_CHUNKS,
    ChunkNote,
    LectureOverview,
    Notes,
    PipelineCancelled,
    Transcript,
    Usage,
)
from .transcription import TRANSCRIPTION_VERSION, transcribe

CACHE_VERSION = "lecnote-complete-stage-v1"


def atomic_json(path: Path, data):
    """Only replace a complete JSON file after its temporary sibling is flushed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as stream:
            name = stream.name
            json.dump(data, stream, ensure_ascii=False, allow_nan=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if name is not None:
            Path(name).unlink(missing_ok=True)


def _digest(data):
    return hashlib.sha256(
        json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    ).hexdigest()


def _save_stage(path, key, data, usage=None):
    payload = {"data": data, "usage": (usage or Usage()).model_dump()}
    atomic_json(
        path,
        {"version": CACHE_VERSION, "key": key, "complete": True, "checksum": _digest(payload), **payload},
    )


def _read_stage(path, key, schema):
    try:
        if path.stat().st_size > 16_000_000:
            return None
        record = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(record, dict):
            return None
        if (
            record.get("version") != CACHE_VERSION
            or record.get("key") != key
            or record.get("complete") is not True
        ):
            return None
        payload = {"data": record["data"], "usage": record["usage"]}
        if record.get("checksum") != _digest(payload):
            return None
        return schema.model_validate(record["data"]), Usage.model_validate(record["usage"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _file_digest(path: Path, check):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            check()
            digest.update(block)
    return digest.hexdigest()


def chunk_transcript(transcript: dict, chunk_minutes: float = 8) -> list[dict]:
    transcript = Transcript.model_validate(transcript).model_dump()
    if not math.isfinite(chunk_minutes) or not 0.25 <= chunk_minutes <= 60:
        raise ValueError("Chunk duration must be between 0.25 and 60 minutes")
    chunks, current = [], []
    window_end, characters = 0, 0

    def append_chunk():
        if current:
            chunks.append(
                {
                    "index": len(chunks),
                    "start": current[0]["start"],
                    "end": max(segment["end"] for segment in current),
                    "segments": list(current),
                }
            )

    for segment in transcript["segments"]:
        if not segment["text"].strip():
            continue
        size = len(segment["text"])
        if current and (segment["start"] >= window_end or characters + size > MAX_CHUNK_CHARACTERS):
            append_chunk()
            current, characters = [], 0
        if not current:
            window_end = (math.floor(segment["start"] / (chunk_minutes * 60)) + 1) * chunk_minutes * 60
        current.append(segment)
        characters += size
    append_chunk()
    if not chunks:
        raise ValueError(
            "Transcript has no speech segments; import or correct the transcript before generating notes"
        )
    if len(chunks) > MAX_CHUNKS:
        raise ValueError("Lecture has too many chunks; split it into smaller lectures")
    return chunks


def run_pipeline(lecture: dict, settings, progress, is_cancelled) -> dict:
    def check():
        if is_cancelled():
            raise PipelineCancelled("Processing cancelled; completed stages are saved for resume")

    check()
    root = Path(settings.lecture_dir(lecture["id"]))
    root.mkdir(parents=True, exist_ok=True)
    media = Path(lecture["media_path"]) if lecture.get("media_path") else None
    source_hash = _file_digest(media, check) if media and media.is_file() else None
    language = lecture.get("language") or getattr(settings, "language", "")
    transcription_key = _digest(
        {
            "source": source_hash,
            "model": settings.whisper_model,
            "language": language,
            "vocabulary": lecture.get("vocabulary") or "",
            "version": TRANSCRIPTION_VERSION,
        }
    )
    transcription_path = root / "cache" / "transcripts" / f"{transcription_key}.json"
    if lecture.get("transcript") is not None:
        transcript = Transcript.model_validate(lecture["transcript"])
    else:
        cached = _read_stage(transcription_path, transcription_key, Transcript)
        if cached:
            transcript = cached[0]
            progress("transcribing", 35, "Using completed local transcription")
        else:
            if media is None or not media.is_file():
                raise RuntimeError("Recording not found; re-import the recording or provide a transcript")

            def local_progress(percent, message):
                check()
                progress("transcribing", min(35, max(0, percent) * 0.35), message)

            check()
            transcription_settings = SimpleNamespace(whisper_model=settings.whisper_model, language=language)
            transcript = Transcript.model_validate(
                transcribe(
                    media,
                    transcription_settings,
                    vocabulary=lecture.get("vocabulary") or "",
                    progress=local_progress,
                )
            )
            _save_stage(transcription_path, transcription_key, transcript.model_dump())
    atomic_json(root / "transcript.json", transcript.model_dump())
    check()
    diarize = lecture.get("diarize", getattr(settings, "diarization", False))
    if diarize:
        if media is None or not media.is_file():
            raise RuntimeError("Speaker detection requires the original recording")
        speaker_key = _digest(
            {"transcript": transcript.model_dump(), "source": source_hash, "stage": "local-pyannote-v1"}
        )
        speaker_path = root / "cache" / "speakers" / f"{speaker_key}.json"
        cached = _read_stage(speaker_path, speaker_key, Transcript)
        if cached:
            transcript = cached[0]
        else:
            from .enrichment import diarize_segments

            progress("transcribing", 36, "Detecting speakers locally")
            segments = diarize_segments(
                media, transcript.model_dump()["segments"], getattr(settings, "hf_token", "")
            )
            transcript = Transcript.model_validate(transcript.model_dump() | {"segments": segments})
            _save_stage(speaker_path, speaker_key, transcript.model_dump())
        atomic_json(root / "transcript.json", transcript.model_dump())
    check()
    if lecture.get("transcribe_only"):
        progress("ready", 100, "Local transcription ready")
        return {"transcript": transcript.model_dump(), "notes": None}
    context = SupportingContext(lecture)
    chunks = chunk_transcript(transcript.model_dump(), settings.chunk_minutes)
    cache_key = _digest(
        {
            "source": source_hash,
            "transcript": transcript.model_dump(),
            "context": {"title": context.title, "sources": context.sources}
            if context.limited else context.full,
            **({"context_selection": "relevant-excerpts-v1"} if context.limited else {}),
            "model": settings.model,
            "prompt": note_service.PROMPT_VERSION,
            "instructions": [note_service.CHUNK_INSTRUCTIONS, note_service.OVERVIEW_INSTRUCTIONS],
            "settings": {
                "chunk_minutes": settings.chunk_minutes,
                "language": language,
                "whisper_model": settings.whisper_model,
                "diarize": diarize,
                "max_output_tokens": note_service.MAX_OUTPUT_TOKENS,
            },
            "version": CACHE_VERSION,
        }
    )
    cache_dir = root / "cache" / "notes" / cache_key
    generation_path = cache_dir / "generation.json"
    if lecture.get("force"):
        # A fresh namespace avoids mixing old and regenerated chunks if a forced
        # run fails halfway. Normal resume follows the latest namespace.
        generation = uuid.uuid4().hex
        atomic_json(generation_path, {"generation": generation})
    else:
        try:
            generation = json.loads(generation_path.read_text(encoding="utf-8"))["generation"]
        except (OSError, ValueError, KeyError, TypeError):
            generation = None
    if generation is not None:
        if (
            not isinstance(generation, str)
            or len(generation) != 32
            or any(c not in "0123456789abcdef" for c in generation)
        ):
            raise ValueError("Invalid notes cache generation; force regeneration to repair the cache")
        cache_dir = cache_dir / generation
    completed, usage_by_chunk = {}, {}
    pending = []
    for chunk in chunks:
        cached = _read_stage(cache_dir / f"chunk-{chunk['index']:04d}.json", cache_key, ChunkNote)
        if cached:
            try:
                note_service.validate_grounding(cached[0], chunk)
                completed[chunk["index"]], usage_by_chunk[chunk["index"]] = cached
                continue
            except (ValueError, ValidationError):
                pass
        pending.append(chunk)
    generator = note_service.NoteGenerator(settings, is_cancelled)

    def process_chunk(chunk):
        check()
        query = " ".join(segment["text"] for segment in chunk["segments"])
        note, usage = generator.generate_chunk(chunk, context.select(query))
        _save_stage(cache_dir / f"chunk-{chunk['index']:04d}.json", cache_key, note.model_dump(), usage)
        return chunk["index"], note, usage

    try:
        progress("generating", 40, f"Generating study notes ({len(completed)}/{len(chunks)} chunks cached)")
        workers = min(4, max(1, int(settings.parallel_requests)))
        # Submit only a worker-sized batch. In-flight successful requests save
        # themselves even if another request fails or cancellation arrives.
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="lecnote-notes") as executor:
            remaining = iter(pending)
            futures = set()
            for _ in range(min(workers, len(pending))):
                check()
                futures.add(executor.submit(process_chunk, next(remaining)))
            while futures:
                done, futures = wait(futures, timeout=0.1, return_when=FIRST_COMPLETED)
                for future in done:
                    index, note, usage = future.result()
                    completed[index], usage_by_chunk[index] = note, usage
                check()
                if done:
                    progress(
                        "generating",
                        40 + 40 * len(completed) / len(chunks),
                        f"Saved {len(completed)} of {len(chunks)} note chunks",
                    )
                for _ in done:
                    chunk = next(remaining, None)
                    if chunk is not None:
                        check()
                        futures.add(executor.submit(process_chunk, chunk))
        check()
        ordered = [completed[i] for i in range(len(chunks))]
        progress("generating", 85, "Synthesizing lecture overview and review material")
        overview_path = cache_dir / "overview.json"
        # Include validated chunk content so repaired/corrupt chunks cannot leave
        # a stale overview even under the same original source key.
        overview_key = _digest({"key": cache_key, "chunks": [c.model_dump() for c in ordered]})
        cached = _read_stage(overview_path, overview_key, LectureOverview)
        if cached:
            overview, overview_usage = cached
        else:
            query = " ".join(note.title + " " + note.summary for note in ordered)
            overview, overview_usage = generator.summarize(
                ordered, lecture.get("title", "Lecture"), context.select(query)
            )
            _save_stage(overview_path, overview_key, overview.model_dump(), overview_usage)
        check()
        total_usage = Usage(
            input_tokens=sum(u.input_tokens for u in usage_by_chunk.values()) + overview_usage.input_tokens,
            output_tokens=sum(u.output_tokens for u in usage_by_chunk.values())
            + overview_usage.output_tokens,
        )
        result = Notes(**overview.model_dump(), chunks=ordered, usage=total_usage, model=settings.model)
        from .exports import render_visual_assets

        progress("generating", 95, "Rendering local study visuals")
        render_visual_assets(result, root / "assets", lecture["id"], check)
        check()
        atomic_json(root / "notes.json", result.model_dump())
        progress("ready", 100, "Lecture notes ready")
        return {"transcript": transcript.model_dump(), "notes": result.model_dump()}
    finally:
        generator.close()

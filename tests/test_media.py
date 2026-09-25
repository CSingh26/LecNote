import math
import shutil
import struct
import subprocess
import sys
import threading
import time
import wave
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from lecnote.config import Settings
from lecnote.db import Repository
from lecnote.jobs import JobManager
from lecnote.media import MediaBusy, MediaError, MediaLimits, MediaService
from lecnote.schemas import PipelineCancelled, Transcript

STAMP = datetime(2026, 1, 1, tzinfo=timezone.utc)
DUE = STAMP + timedelta(hours=6)
FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")
real_audio = pytest.mark.skipif(not (FFMPEG and FFPROBE), reason="FFmpeg is not installed")


def wav(path, duration=1, frequency=440):
    with wave.open(str(path), "wb") as handle:
        handle.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
        handle.writeframes(
            b"".join(
                struct.pack("<h", int(8000 * math.sin(2 * math.pi * frequency * n / 24000)))
                for n in range(round(duration * 24000))
            )
        )
    return path


@pytest.fixture
def library(tmp_path):
    settings = Settings(data_dir=tmp_path)
    repo = Repository(tmp_path / "library.sqlite3")
    repo.create("courses", {"id": "course", "name": "Course"})
    return repo, settings, MediaService(repo, settings)


def lecture(library, identifier, duration=1, **values):
    repo, settings, service = library
    path = wav(settings.lecture_dir(identifier) / "recording.wav", duration)
    item = repo.create(
        "lectures",
        {
            "id": identifier,
            "title": identifier,
            "status": "draft",
            "course_id": "course",
            "media_path": str(path),
            "media_type": "audio/wav",
            "source_name": path.name,
            "duration": duration,
            "notes": None,
            "transcript": {
                "language": "en",
                "duration": duration,
                "segments": [{"id": 7, "start": 0, "end": duration / 2, "text": identifier, "speaker": None}],
            },
            **values,
        },
    )
    if item["status"] != "recording":
        service.mark_finalized(identifier, finalized_at=STAMP)
    return repo.get("lectures", identifier)


def test_validation_preserves_stream_duration_when_decode_progress_is_short(library, monkeypatch):
    _, _, service = library
    monkeypatch.setattr(service, "_probe", lambda *a, **kw: (2.0, False))
    monkeypatch.setattr(service, "_run", lambda *a, **kw: "out_time_us=1950667\nprogress=end\n")
    assert service._validate(Path("recording.wav"), expected=2.0) == 2.0


@pytest.mark.parametrize("progress", [0, 1_500_000, 2_500_000])
def test_validation_still_rejects_incomplete_or_mismatched_decode(library, monkeypatch, progress):
    _, _, service = library
    monkeypatch.setattr(service, "_probe", lambda *a, **kw: (2.0, False))
    monkeypatch.setattr(service, "_run", lambda *a, **kw: f"out_time_us={progress}\nprogress=end\n")
    with pytest.raises(MediaError, match="Decoded audio duration"):
        service._validate(Path("recording.wav"))


@real_audio
def test_merge_order_offsets_provenance_and_sources_unchanged(library):
    repo, _, service = library
    a = lecture(library, "a", 2)
    b = lecture(library, "b", 1)
    originals = {x["id"]: Path(x["media_path"]).read_bytes() for x in (a, b)}
    merged = service.merge(["b", "a"], title="Combined")
    assert merged["course_id"] == "course"
    assert merged["title"] == "Combined"
    assert merged["media_type"] == "audio/mp4"
    assert Path(merged["media_path"]).suffix == ".m4a"
    transcript = Transcript.model_validate(merged["transcript"])
    assert transcript.duration == pytest.approx(3, abs=0.05)
    assert [s.text for s in transcript.segments] == ["b", "a"]
    assert [s.id for s in transcript.segments] == [0, 1]
    assert transcript.segments[1].start == pytest.approx(1, abs=0.01)
    assert [s["lecture_id"] for s in merged["merge_sources"]] == ["b", "a"]
    assert merged["segment_sources"][1]["source_lecture_id"] == "a"
    assert merged["segment_sources"][1]["source_segment_id"] == 7
    assert merged["segment_sources"][1]["source_start"] == 0
    for x in (a, b):
        assert repo.get("lectures", x["id"]) == x
        assert Path(x["media_path"]).read_bytes() == originals[x["id"]]


@real_audio
@pytest.mark.parametrize("partial", [False, True])
@pytest.mark.parametrize("overrun", [1.248, 2.0])
def test_merge_bounds_small_tail_overrun_without_changing_sources(library, partial, overrun):
    repo, _, service = library
    lecture(library, "first")
    transcript = {"language": "en", "duration": 10 + overrun, "segments": [
        {"id": 7, "start": 9, "end": 10 + overrun, "text": "Keep the final sentence."},
    ]}
    lecture(library, "middle", 10, **(
        {"transcript": None, "partial_transcript": transcript} if partial else {"transcript": transcript}
    ))
    lecture(library, "last")
    originals = repo.list("lectures")
    audio = {item["media_path"]: Path(item["media_path"]).read_bytes() for item in originals}

    merged = service.merge(["first", "middle", "last"])

    result = Transcript.model_validate(merged["partial_transcript"] if partial else merged["transcript"])
    assert result.duration == pytest.approx(12)
    assert [segment.text for segment in result.segments] == ["first", "Keep the final sentence.", "last"]
    assert result.segments[1].start == pytest.approx(10)
    assert result.segments[1].end == pytest.approx(11)
    assert result.segments[2].start == pytest.approx(11)
    assert merged["merge_sources"][2]["offset"] == pytest.approx(11)
    assert merged["segment_sources"][1]["source_end"] == 10 + overrun
    if partial:
        assert merged["transcript"] is None
    for item in originals:
        assert repo.get("lectures", item["id"]) == item
        assert Path(item["media_path"]).read_bytes() == audio[item["media_path"]]


@real_audio
@pytest.mark.parametrize("start,end", [(9, 12.01), (10, 10.2), (10.1, 10.2)])
def test_merge_rejects_large_or_wholly_outside_transcript_without_mutation(library, start, end):
    repo, settings, service = library
    lecture(library, "first", 10, transcript={"language": "en", "duration": end, "segments": [
        {"id": 0, "start": start, "end": end, "text": "Mismatched timing"},
    ]})
    lecture(library, "last")
    before = repo.list("lectures")
    folders = set((settings.data_dir / "lectures").iterdir())
    with pytest.raises(MediaError, match="transcript extends beyond its audio"):
        service.merge(["first", "last"])
    assert repo.list("lectures") == before
    assert set((settings.data_dir / "lectures").iterdir()) == folders


@pytest.mark.parametrize("mode", ["single", "duplicate", "course", "recording", "job", "explicit_busy"])
def test_merge_rejects_invalid_or_busy_inputs_without_mutation(library, mode):
    repo, settings, service = library
    lecture(library, "a")
    lecture(
        library,
        "b",
        course_id="other" if mode == "course" else "course",
        status="recording" if mode == "recording" else "draft",
    )
    if mode == "job":
        repo.create("jobs", {"lecture_id": "a", "status": "running"})
    before = repo.list("lectures")
    ids = ["a"] if mode == "single" else ["a", "a"] if mode == "duplicate" else ["a", "b"]
    with pytest.raises((MediaError, MediaBusy)):
        service.merge(ids, busy_ids={"b"} if mode == "explicit_busy" else ())
    assert repo.list("lectures") == before
    assert len(list((settings.data_dir / "lectures").iterdir())) == 2


@real_audio
@pytest.mark.parametrize(
    "limits",
    [
        MediaLimits(max_duration_seconds=1),
        MediaLimits(max_source_bytes=10),
        MediaLimits(max_transcript_characters=1),
        MediaLimits(max_segments=1),
    ],
)
def test_merge_limits_preserve_sources(library, limits):
    repo, settings, _ = library
    lecture(library, "first")
    lecture(library, "second")
    before = repo.list("lectures")
    with pytest.raises(MediaError):
        MediaService(repo, settings, limits=limits).merge(["first", "second"])
    assert repo.list("lectures") == before


def test_merge_rejects_unrelated_recording_before_ffmpeg(library, monkeypatch):
    repo, settings, service = library
    lecture(library, "a")
    lecture(library, "b")
    lecture(library, "live", course_id="other", status="recording")
    before = repo.list("lectures")
    originals = {x["media_path"]: Path(x["media_path"]).read_bytes() for x in before}
    folders = set((settings.data_dir / "lectures").iterdir())
    monkeypatch.setattr(service, "_run", lambda *a, **kw: pytest.fail("FFmpeg started during recording"))
    with pytest.raises(MediaBusy):
        service.merge(["a", "b"])
    assert repo.list("lectures") == before
    assert set((settings.data_dir / "lectures").iterdir()) == folders
    assert all(Path(path).read_bytes() == data for path, data in originals.items())


@real_audio
@pytest.mark.parametrize("hints,transcript_languages,expected", [
    (("", ""), (None, None), ""),
    (("es", "es"), (None, None), "es"),
    (("", "fr"), (None, None), "fr"),
    (("en", "es"), (None, None), ""),
    (("unknown", "mixed"), (None, None), ""),
    (("multi", "invalid"), (None, None), ""),
    (("", ""), ("en", None), "en"),
    (("", ""), ("en", "es"), ""),
    (("", ""), ("mixed", "multi"), ""),
])
def test_merge_keeps_only_unambiguous_supported_language_hints(
    library, hints, transcript_languages, expected,
):
    _, _, service = library
    for identifier, hint, language in zip(("a", "b"), hints, transcript_languages):
        transcript = None if language is None else {"language": language, "duration": 1, "segments": []}
        lecture(library, identifier, language=hint, transcript=transcript)
    assert service.merge(["a", "b"])["language"] == expected


def test_persistent_six_hour_eligibility_is_not_reset(library):
    repo, settings, service = library
    original = lecture(library, "a")
    restarted = MediaService(repo, settings)
    restarted.mark_finalized("a", finalized_at=DUE)
    assert repo.get("lectures", "a")["finalized_at"] == original["finalized_at"]
    assert restarted.compress("a", now=DUE - timedelta(seconds=1))["reason"] == "not_due"
    repo.update("lectures", "a", {"finalized_at": None})
    assert restarted.compress("a", now=DUE)["reason"] == "not_finalized"


@pytest.mark.parametrize(
    "mode", ["workspace", "course", "lecture", "recording", "busy", "merge", "job", "chunk"]
)
def test_compression_skips_opt_outs_and_busy_sources_without_writes(library, mode):
    repo, settings, service = library
    item = lecture(library, "a")
    if mode == "workspace":
        settings.optimize_recordings = False
    if mode == "course":
        repo.update("courses", "course", {"optimize_recordings": False})
    if mode == "lecture":
        repo.update("lectures", "a", {"optimize_recordings": False})
    if mode == "recording":
        repo.update("lectures", "a", {"status": "recording"})
    if mode == "job":
        repo.create("jobs", {"lecture_id": "merged", "source_lecture_ids": ["a"], "status": "queued"})
    if mode == "chunk":
        repo.add_chunk("a", 0, {"sequence": 0, "status": "queued", "path": item["media_path"]})
    before = repo.get("lectures", "a")
    result = service.compress(
        "a",
        now=DUE,
        busy_ids={"a"} if mode == "busy" else (),
        merge_input_ids={"a"} if mode == "merge" else (),
    )
    assert result["status"] == "skipped"
    assert repo.get("lectures", "a") == before
    assert Path(item["media_path"]).exists()


@real_audio
def test_compression_verified_replacement_then_only_owned_chunk_cleanup(library):
    repo, settings, service = library
    item = lecture(library, "a", 2)
    folder = settings.lecture_dir("a")
    chunk = wav(folder / "chunk-0.wav")
    unrelated = wav(folder / "keep.wav")
    outside = wav(settings.lecture_dir("other") / "chunk.wav")
    for sequence, path in enumerate((chunk, outside)):
        repo.add_chunk(
            "a",
            sequence,
            {
                "sequence": sequence,
                "status": "completed",
                "path": str(path),
                "segments": [{"text": "keep transcript"}],
            },
        )
    result = service.compress("a", now=DUE)
    saved = repo.get("lectures", "a")
    assert result["status"] == "compressed"
    assert saved["compression"]["status"] == "compressed"
    assert saved["transcript"] == item["transcript"]
    assert not Path(item["media_path"]).exists()
    assert Path(saved["media_path"]).is_file()
    assert not chunk.exists()
    assert outside.exists() and unrelated.exists()
    assert repo.list_chunks("a")[0]["segments"] == [{"text": "keep transcript"}]
    assert repo.list_chunks("a")[0]["path"] is None


@real_audio
@pytest.mark.parametrize("failure", ["encode", "decode", "duration", "publish", "database"])
def test_failure_keeps_original_and_chunks_and_persists_retry(library, monkeypatch, failure):
    repo, settings, service = library
    item = lecture(library, "a", 2)
    original = Path(item["media_path"]).read_bytes()
    chunk = wav(settings.lecture_dir("a") / "chunk.wav")
    repo.add_chunk("a", 0, {"sequence": 0, "status": "completed", "path": str(chunk)})

    def fail(*args, **kwargs):
        raise OSError("synthetic failure")

    if failure == "encode":
        monkeypatch.setattr(service, "_encode", fail)
    elif failure == "decode":
        validate = service._validate
        monkeypatch.setattr(
            service,
            "_validate",
            lambda path, expected=None: fail() if Path(path).suffix == ".m4a" else validate(path, expected),
        )
    elif failure == "duration":
        encode = service._encode
        monkeypatch.setattr(
            service, "_encode", lambda paths, target: encode([wav(target.parent / "short.wav", 0.1)], target)
        )
    elif failure == "publish":
        monkeypatch.setattr("lecnote.media.os.replace", fail)
    else:
        update = repo.update

        def failed_update(table, identifier, values):
            if values.get("media_type") == "audio/mp4":
                fail()
            return update(table, identifier, values)

        monkeypatch.setattr(repo, "update", failed_update)
    result = service.compress("a", now=DUE)
    saved = repo.get("lectures", "a")
    assert result["status"] == "failed"
    assert saved["media_path"] == item["media_path"]
    assert Path(item["media_path"]).read_bytes() == original
    assert chunk.exists()
    assert saved["compression"]["attempts"] == 1
    next_at = datetime.fromisoformat(saved["compression"]["next_attempt_at"])
    assert next_at > DUE
    restarted = MediaService(repo, settings)
    assert restarted.compress("a", now=DUE)["reason"] == "backoff"


@real_audio
def test_already_compact_audio_is_retained_with_chunks(library):
    repo, settings, service = library
    item = lecture(library, "a", 1)
    compact = settings.lecture_dir("a") / "small.m4a"
    subprocess.run(
        [FFMPEG, "-v", "error", "-i", item["media_path"], "-c:a", "aac", "-b:a", "12k", str(compact)],
        check=True,
        capture_output=True,
    )
    repo.update("lectures", "a", {"media_path": str(compact), "media_type": "audio/mp4"})
    before = compact.read_bytes()
    result = service.compress("a", now=DUE)
    assert result["reason"] == "not_smaller"
    assert compact.read_bytes() == before
    assert repo.get("lectures", "a")["media_path"] == str(compact)


@real_audio
def test_shared_source_is_never_deleted(library):
    repo, _, service = library
    a = lecture(library, "a", 2)
    lecture(library, "b")
    repo.update("lectures", "b", {"media_path": a["media_path"]})
    result = service.compress("a", now=DUE)
    assert result["reason"] == "shared_source"
    assert Path(a["media_path"]).exists()


@real_audio
def test_merge_video_keeps_only_audio_and_preserves_video(library):
    repo, settings, service = library
    item = lecture(library, "a", 1)
    lecture(library, "b", 1)
    video = settings.lecture_dir("a") / "video.mp4"
    subprocess.run(
        [
            FFMPEG,
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=16x16:d=1",
            "-i",
            item["media_path"],
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-shortest",
            str(video),
        ],
        check=True,
        capture_output=True,
    )
    repo.update("lectures", "a", {"media_path": str(video), "media_type": "video/mp4"})
    merged = service.merge(["a", "b"])
    result = subprocess.run(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            merged["media_path"],
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == "audio"
    assert video.exists()


@pytest.mark.parametrize(
    "global_value,course_value,enabled",
    [
        (False, None, False),
        (True, None, True),
        (True, False, False),
        (False, True, True),
    ],
)
def test_course_optimization_inherits_or_overrides_workspace(library, global_value, course_value, enabled):
    repo, settings, service = library
    lecture(library, "a")
    settings.optimize_recordings = global_value
    repo.update("courses", "course", {"optimize_recordings": course_value})
    assert service.compression_candidates(now=DUE) == (["a"] if enabled else [])


@real_audio
def test_maintenance_compresses_only_one_eligible_recording(library):
    repo, _, service = library
    lecture(library, "a")
    lecture(library, "b")
    lecture(library, "recent")
    repo.update("lectures", "recent", {"finalized_at": DUE.isoformat()})
    assert len(service.compress_due(now=DUE)) == 1
    assert sum(x["compression"]["status"] == "compressed" for x in repo.list("lectures")) == 1
    assert len(service.compress_due(now=DUE)) == 1
    assert service.compress_due(now=DUE) == []


def test_any_recording_blocks_automatic_maintenance(library):
    _, _, service = library
    lecture(library, "a")
    lecture(library, "live", status="recording")
    assert service.compression_candidates(now=DUE) == []
    assert service.compress_due(now=DUE) == []


def test_retry_limit_stops_repeated_invalid_input_processing(library, monkeypatch):
    repo, _, service = library
    item = lecture(library, "a")

    def fail(*args, **kwargs):
        raise MediaError("corrupt file")

    monkeypatch.setattr(service, "_probe", fail)
    timestamp = DUE
    for _ in range(5):
        assert service.compress("a", now=timestamp)["status"] == "failed"
        timestamp = datetime.fromisoformat(repo.get("lectures", "a")["compression"]["next_attempt_at"])
    assert service.compress("a", now=timestamp)["reason"] == "retry_exhausted"
    assert service.compression_candidates(now=timestamp) == []
    assert Path(item["media_path"]).exists()


@real_audio
def test_missing_transcript_retains_partial_text_for_full_retranscription(library):
    _, _, service = library
    lecture(library, "a")
    lecture(library, "b", transcript=None)
    merged = service.merge(["a", "b"])
    assert merged["transcript"] is None
    assert merged["partial_transcript"]["segments"][0]["text"] == "a"
    assert merged["segment_sources"][0]["source_lecture_id"] == "a"


@real_audio
def test_nested_merge_keeps_root_provenance_and_actual_audio_offsets(library):
    _, _, service = library
    lecture(library, "a")
    lecture(library, "b")
    first = service.merge(["a", "b"])
    nested = service.merge([first["id"], "a"])
    assert [s["source_lecture_id"] for s in nested["segment_sources"]] == ["a", "b", "a"]
    assert nested["segment_sources"][1]["source_start"] == 0
    assert nested["transcript"]["segments"][2]["start"] == pytest.approx(2, abs=0.1)


@real_audio
@pytest.mark.parametrize(
    "mode", ["cancel_before", "cancel_after_encode", "encode_failure", "database_failure"]
)
def test_merge_cancellation_and_failures_leave_no_destination(library, monkeypatch, mode):
    repo, settings, service = library
    lecture(library, "a")
    lecture(library, "b")
    before = repo.list("lectures")
    cancel = mode == "cancel_before"

    def fail(*args, **kwargs):
        raise OSError("synthetic failure")

    encode = service._encode

    def encode_then_cancel(*args, **kwargs):
        nonlocal cancel
        encode(*args, **kwargs)
        cancel = True

    if mode == "cancel_after_encode":
        monkeypatch.setattr(service, "_encode", encode_then_cancel)
    elif mode == "encode_failure":
        monkeypatch.setattr(service, "_encode", fail)
    elif mode == "database_failure":
        monkeypatch.setattr(repo, "create", fail)
    with pytest.raises((PipelineCancelled, OSError)):
        service.merge(["a", "b"], cancelled=lambda: cancel)
    assert repo.list("lectures") == before
    assert len(list((settings.data_dir / "lectures").iterdir())) == 2


def test_cannot_finalize_a_live_chunk_as_the_final_recording(library):
    repo, settings, service = library
    path = wav(settings.lecture_dir("live") / "chunk-0.wav")
    repo.create("lectures", {"id": "live", "status": "interrupted", "media_path": str(path)})
    repo.add_chunk("live", 0, {"sequence": 0, "path": str(path), "status": "completed"})
    with pytest.raises(MediaError):
        service.mark_finalized("live")
    assert not repo.get("lectures", "live").get("finalized_at")


@real_audio
def test_automatic_compression_preserves_video_even_with_wrong_mime_type(library):
    repo, settings, service = library
    item = lecture(library, "a")
    video = settings.lecture_dir("a") / "video.mp4"
    subprocess.run(
        [
            FFMPEG,
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=16x16:d=1",
            "-i",
            item["media_path"],
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-shortest",
            str(video),
        ],
        check=True,
        capture_output=True,
    )
    repo.update("lectures", "a", {"media_path": str(video), "media_type": "audio/mp4"})
    before = video.read_bytes()
    assert service.compress("a", now=DUE)["reason"] == "video"
    assert video.read_bytes() == before


@real_audio
def test_compression_cancellation_keeps_source_and_retry_state(library, monkeypatch):
    repo, _, service = library
    item = lecture(library, "a")
    cancelled = False
    encode = service._encode

    def encode_then_cancel(*args, **kwargs):
        nonlocal cancelled
        encode(*args, **kwargs)
        cancelled = True

    monkeypatch.setattr(service, "_encode", encode_then_cancel)
    with pytest.raises(PipelineCancelled):
        service.compress_due(now=DUE, cancelled=lambda: cancelled)
    assert repo.get("lectures", "a") == item
    assert Path(item["media_path"]).exists()


def test_subprocess_is_terminated_promptly_on_cancellation(library):
    _, _, service = library
    started = time.monotonic()
    with pytest.raises(PipelineCancelled):
        service._run(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            cancelled=lambda: time.monotonic() - started >= 0.1,
        )
    assert time.monotonic() - started < 5


@real_audio
def test_remerging_partial_transcript_preserves_available_text(library):
    _, _, service = library
    lecture(library, "a")
    lecture(library, "b", transcript=None)
    first = service.merge(["a", "b"])
    nested = service.merge([first["id"], "a"])
    assert nested["transcript"] is None
    assert [s["text"] for s in nested["partial_transcript"]["segments"]] == ["a", "a"]
    assert [s["source_lecture_id"] for s in nested["segment_sources"]] == ["a", "a"]


@real_audio
@pytest.mark.parametrize("operation", ["merge", "compress"])
def test_source_file_change_during_encode_prevents_publication(library, monkeypatch, operation):
    repo, settings, service = library
    a = lecture(library, "a")
    lecture(library, "b")
    encode = service._encode

    def encode_then_change(*args, **kwargs):
        encode(*args, **kwargs)
        wav(Path(a["media_path"]), 2)

    monkeypatch.setattr(service, "_encode", encode_then_change)
    if operation == "merge":
        with pytest.raises(MediaBusy):
            service.merge(["a", "b"])
    else:
        assert service.compress("a", now=DUE)["status"] == "skipped"
    assert repo.get("lectures", "a")["media_path"] == a["media_path"]
    assert len(list((settings.data_dir / "lectures").iterdir())) == 2
    assert Path(a["media_path"]).stat().st_size > 90000


@pytest.mark.parametrize("outcome", ["final", "checkpoint_failure", "checkpoint_cancel"])
def test_replaced_transcript_rebuilds_provenance_and_preserves_saved_work(library, monkeypatch, outcome):
    repo, settings, _ = library
    lecture(library, "merged", transcript=None, notes={"title": "Saved notes"},
            merge_sources=[
                {"lecture_id": "a", "offset": 0, "duration": 0.5},
                {"lecture_id": "b", "offset": 0.5, "duration": 0.5},
            ],
            segment_sources=[{"segment_id": 0, "source_lecture_id": "b", "source_segment_id": 7}])
    transcript = {"language": "en", "duration": 1, "segments": [
        {"id": 0, "start": 0, "end": 0.4, "text": "Recovered A"},
        {"id": 1, "start": 0.4, "end": 0.8, "text": "Crosses both sources"},
    ]}

    def pipeline(lecture, settings, progress, cancelled, checkpoint):
        if outcome != "final":
            checkpoint({"transcript": transcript})
            if outcome == "checkpoint_cancel":
                raise PipelineCancelled("Cancelled after saving transcript")
            raise RuntimeError("Notes provider failed")
        return {"transcript": transcript, "notes": None}

    monkeypatch.setattr("lecnote.pipeline.run_pipeline", pipeline)
    manager = JobManager(repo, settings, start_worker=False)
    try:
        job = manager.enqueue("merged", transcribe_only=True)
        manager._run(job["id"])
        saved = repo.get("lectures", "merged")
        assert saved["transcript"] == transcript
        assert saved["notes"] == {"title": "Saved notes"}
        sources = saved["segment_sources"]
        assert [(s["segment_id"], s["source_lecture_id"]) for s in sources] == [(0, "a"), (1, "a"), (1, "b")]
        assert all(s.get("source_segment_id") is None for s in sources)
        assert sources[-1]["source_start"] == 0
        assert sources[-1]["source_end"] == pytest.approx(0.3)
    finally:
        manager.close()


@real_audio
def test_nested_retranscription_uses_root_audio_ranges_even_after_source_deletion(library):
    from lecnote.media import transcript_provenance

    repo, _, service = library
    lecture(library, "a", transcript=None)
    lecture(library, "b")
    first = service.merge(["a", "b"])
    regenerated = {"language": "en", "duration": 2, "segments": [
        {"id": 0, "start": 0, "end": 0.5, "text": "Recovered A"},
        {"id": 1, "start": 0.8, "end": 1.2, "text": "Both"},
    ]}
    repo.update("lectures", first["id"], {
        "transcript": regenerated, **transcript_provenance(first, regenerated),
    })
    nested = service.merge([first["id"], "b"])
    assert [s["source_lecture_id"] for s in nested["segment_sources"]] == ["a", "a", "b", "b"]
    repo.delete("lectures", first["id"])
    replaced = {"segments": [{"id": 0, "start": 0.8, "end": 2.2}]}
    sources = transcript_provenance(nested, replaced)["segment_sources"]
    assert [s["source_lecture_id"] for s in sources] == ["a", "b", "b"]
    assert [s["source_start"] for s in sources] == [pytest.approx(0.8), 0, 0]
    assert all(s.get("source_segment_id") is None for s in sources)


@pytest.mark.parametrize("outcome", ["success", "failure", "cancel"])
def test_live_full_recovery_retires_chunks_only_after_transcript_saved(library, monkeypatch, outcome):
    repo, settings, service = library
    item = lecture(library, "live", transcript=None)
    repo.update("lectures", "live", {"media_path": None, "finalized_at": None})
    chunk_path = wav(settings.lecture_dir("live") / "chunk.wav")
    repo.add_chunk("live", 0, {"sequence": 0, "path": str(chunk_path), "status": "queued", "offset": 0, "duration": 1})
    transcript = {"language": "en", "duration": 1, "segments": [{"id": 0, "start": 0, "end": 1, "text": "Recovered"}]}

    def pipeline(*args):
        if outcome == "cancel":
            raise PipelineCancelled("Cancelled")
        if outcome == "failure":
            raise RuntimeError("Failed")
        return {"transcript": transcript, "notes": None}

    manager = JobManager(repo, settings, pipeline=pipeline, start_worker=False)
    try:
        job = manager.enqueue("live", live_finish=True, transcribe_only=True)
        manager._run(job["id"])
        saved = repo.get("lectures", "live")
        chunk = repo.list_chunks("live")[0]
        assert chunk["status"] == ("archived" if outcome == "success" else "queued")
        assert not chunk.get("segments")
        assert chunk_path.exists() and Path(saved["media_path"]).exists()
        if outcome == "success":
            assert saved["transcript"] == transcript
            timestamp = datetime.fromisoformat(saved["finalized_at"]) + timedelta(hours=6)
            assert service.compression_candidates(now=timestamp) == ["live"]
            monkeypatch.setattr("lecnote.transcription.transcribe", lambda *args: pytest.fail("Late chunk was transcribed"))
            manager._live("live", 0, item.get("live_epoch", 0))
            assert repo.get("lectures", "live")["transcript"] == transcript
    finally:
        manager.close()


@pytest.mark.parametrize("late_failure", [False, True])
def test_inflight_live_result_cannot_replace_finalized_transcript(library, monkeypatch, late_failure):
    repo, settings, _ = library
    lecture(library, "live", transcript=None)
    repo.update("lectures", "live", {"media_path": None, "finalized_at": None})
    path = wav(settings.lecture_dir("live") / "chunk.wav")
    repo.add_chunk("live", 0, {"sequence": 0, "path": str(path), "status": "queued", "offset": 0, "duration": 1})
    entered, release = threading.Event(), threading.Event()

    def transcribe(*args):
        entered.set()
        assert release.wait(3)
        if late_failure:
            raise RuntimeError("Late failure")
        return {"language": "en", "duration": 1, "segments": [{"id": 0, "start": 0, "end": 1, "text": "Late partial"}]}

    monkeypatch.setattr("lecnote.transcription.transcribe", transcribe)
    recovered = {"language": "en", "duration": 1, "segments": [{"id": 0, "start": 0, "end": 1, "text": "Full recovery"}]}
    manager = JobManager(repo, settings, pipeline=lambda *args: {"transcript": recovered, "notes": None}, start_worker=False)
    worker = threading.Thread(target=manager._live, args=("live", 0))
    try:
        worker.start()
        assert entered.wait(2)
        job = manager.enqueue("live", live_finish=True, transcribe_only=True)
        manager._run(job["id"])
        before = repo.get("lectures", "live")
        assert before["transcript"] == recovered
        release.set()
        worker.join(timeout=3)
        assert not worker.is_alive()
        assert repo.get("lectures", "live") == before
        assert repo.list_chunks("live")[0]["status"] == "archived"
    finally:
        release.set()
        worker.join(timeout=3)
        manager.close()

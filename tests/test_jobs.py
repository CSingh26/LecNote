import threading
import time
import wave

import pytest

from lecnote.config import Settings
from lecnote.db import Repository
from lecnote.jobs import JobManager


def _live_recording(repo, settings, *, completed=True):
    interim = {
        "language": "en",
        "duration": 2,
        "segments": [{"id": 0, "start": 0, "end": 1, "text": "The first", "speaker": None}],
    }
    repo.create(
        "lectures",
        {"id": "lecture", "title": "Live", "status": "recording", "transcript": interim},
    )
    folder = settings.lecture_dir("lecture")
    folder.mkdir(parents=True, exist_ok=True)
    for sequence in range(2):
        path = folder / f"{sequence:06d}.wav"
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16_000)
            audio.writeframes(b"\0\0" * 16_000)
        repo.add_chunk(
            "lecture",
            sequence,
            {
                "sequence": sequence,
                "path": str(path),
                "offset": sequence,
                "duration": 1,
                "status": "completed" if completed else "queued",
            },
        )
    return interim


def test_restart_marks_unfinished_jobs_interrupted(tmp_path):
    repo = Repository(tmp_path / "library.sqlite3")
    repo.create("lectures", {"id": "lecture", "title": "Test", "status": "generating"})
    repo.create("jobs", {"id": "job", "lecture_id": "lecture", "status": "running", "progress": 20})
    manager = JobManager(repo, Settings(data_dir=tmp_path), start_worker=False)
    assert repo.get("jobs", "job")["status"] == "interrupted"
    assert repo.get("lectures", "lecture")["status"] == "interrupted"
    manager.close()


def test_job_persists_progress_and_result(tmp_path):
    repo = Repository(tmp_path / "library.sqlite3")
    repo.create("lectures", {"id": "lecture", "title": "Test", "status": "draft", "context": "Test topic"})
    done = threading.Event()

    def pipeline(lecture, settings, progress, is_cancelled):
        progress("generating", 65, "Writing notes")
        return {"transcript": {"duration": 20, "segments": []}, "notes": {"title": "Finished"}}

    manager = JobManager(repo, Settings(data_dir=tmp_path), pipeline=pipeline)
    job = manager.enqueue("lecture")
    for _ in range(100):
        if repo.get("jobs", job["id"])["status"] == "completed":
            done.set()
            break
        time.sleep(0.01)
    manager.close()
    assert done.is_set()
    assert repo.get("lectures", "lecture")["notes"]["title"] == "Finished"
    assert repo.get("jobs", job["id"])["progress"] == 100


def test_provider_error_is_redacted_in_persisted_job(tmp_path):
    repo = Repository(tmp_path / "library.sqlite3")
    repo.create("lectures", {"id": "lecture", "title": "Test", "status": "draft"})

    def pipeline(*args):
        raise RuntimeError("Bad token sk-secret-test")

    manager = JobManager(repo, Settings(data_dir=tmp_path, api_key="sk-secret-test"), pipeline=pipeline)
    job = manager.enqueue("lecture")
    for _ in range(100):
        if repo.get("jobs", job["id"])["status"] == "failed":
            break
        time.sleep(0.01)
    manager.close()
    result = repo.get("jobs", job["id"])
    assert result["status"] == "failed"
    assert "sk-secret-test" not in result["error"]


def test_second_worker_cannot_interrupt_an_existing_library(tmp_path):
    repo = Repository(tmp_path / "library.sqlite3")
    repo.create("lectures", {"id": "lecture", "title": "Active", "status": "draft"})
    first = JobManager(repo, Settings(data_dir=tmp_path), start_worker=False)
    job = first.enqueue("lecture")
    try:
        with pytest.raises(RuntimeError, match="already open"):
            JobManager(repo, Settings(data_dir=tmp_path), start_worker=False)
        assert repo.get("jobs", job["id"])["status"] == "queued"
    finally:
        first.close()
    replacement = JobManager(repo, Settings(data_dir=tmp_path), start_worker=False)
    assert repo.get("jobs", job["id"])["status"] == "interrupted"
    replacement.close()


def test_transcription_only_finishes_as_draft_without_notes(tmp_path):
    repo = Repository(tmp_path / "library.sqlite3")
    repo.create("lectures", {"id": "lecture", "title": "Local", "status": "draft"})

    def pipeline(lecture, settings, progress, cancelled):
        assert lecture["transcribe_only"] is True
        return {"transcript": {"duration": 20, "segments": []}, "notes": None}

    manager = JobManager(repo, Settings(data_dir=tmp_path), pipeline=pipeline)
    try:
        job = manager.enqueue("lecture", transcribe_only=True)
        for _ in range(100):
            if repo.get("jobs", job["id"])["status"] == "completed":
                break
            time.sleep(0.01)
        assert repo.get("jobs", job["id"])["status"] == "completed"
        assert repo.get("lectures", "lecture")["status"] == "draft"
        assert repo.get("lectures", "lecture")["notes"] is None
    finally:
        manager.close()


def test_live_duration_includes_small_whisper_timestamp_overruns(tmp_path, monkeypatch):
    from lecnote.schemas import Transcript

    repo = Repository(tmp_path / "library.sqlite3")
    repo.create("lectures", {"id": "lecture", "title": "Live", "status": "recording"})
    repo.add_chunk(
        "lecture", 0, {"sequence": 0, "path": "test.wav", "offset": 0, "duration": 1, "status": "queued"}
    )
    monkeypatch.setattr(
        "lecnote.transcription.transcribe",
        lambda *args: {
            "language": "en",
            "duration": 1.02,
            "segments": [{"id": 0, "start": 0, "end": 1.02, "text": "Boundary", "speaker": None}],
        },
    )
    manager = JobManager(repo, Settings(data_dir=tmp_path), start_worker=False)
    try:
        manager._live("lecture", 0)
        transcript = repo.get("lectures", "lecture")["transcript"]
        assert transcript["duration"] >= 1.02
        assert Transcript.model_validate(transcript).segments[0].text == "Boundary"
    finally:
        manager.close()


def test_live_finish_transcribes_assembled_audio_and_skips_queued_chunks(tmp_path, monkeypatch):
    from lecnote import pipeline

    repo = Repository(tmp_path / "library.sqlite3")
    settings = Settings(data_dir=tmp_path)
    interim = _live_recording(repo, settings, completed=False)
    calls = []
    final = {
        "language": "en",
        "duration": 2,
        "segments": [{"id": 0, "start": 0, "end": 2, "text": "The first complete thought", "speaker": None}],
    }

    def transcribe(path, *_args, **_kwargs):
        calls.append(path)
        return final

    monkeypatch.setattr(pipeline, "transcribe", transcribe)
    monkeypatch.setattr("lecnote.transcription.transcribe", transcribe)
    manager = JobManager(repo, settings, start_worker=False)
    try:
        manager.queue_chunk("lecture", 0)
        manager.queue_chunk("lecture", 1)
        job = manager.enqueue("lecture", live_finish=True, transcribe_only=True)
        manager._live("lecture", 0, 0)
        manager._live("lecture", 1, 0)
        assert repo.get("lectures", "lecture")["transcript"] == interim
        manager._run(job["id"])
        saved = repo.get("lectures", "lecture")
        assert repo.get("jobs", job["id"])["status"] == "completed"
        assert saved["transcript"] == final
        assert saved["final_transcription_pending"] is False
        assert [path.name for path in calls] == ["recording.wav"]

        repeat = manager.enqueue("lecture", transcribe_only=True)
        manager._run(repeat["id"])
        assert repo.get("jobs", repeat["id"])["status"] == "completed"
        assert [path.name for path in calls] == ["recording.wav"]
    finally:
        manager.close()


def test_live_finish_failure_keeps_interim_and_retry_transcribes_once(tmp_path, monkeypatch):
    from lecnote import pipeline

    repo = Repository(tmp_path / "library.sqlite3")
    settings = Settings(data_dir=tmp_path)
    interim = _live_recording(repo, settings)
    final = {
        "language": "en",
        "duration": 2,
        "segments": [{"id": 0, "start": 0, "end": 2, "text": "The first complete thought", "speaker": None}],
    }
    calls = []

    def transcribe(path, *_args, **_kwargs):
        calls.append(path)
        if len(calls) == 1:
            raise RuntimeError("Local model unavailable")
        return final

    monkeypatch.setattr(pipeline, "transcribe", transcribe)
    manager = JobManager(repo, settings, start_worker=False)
    try:
        job = manager.enqueue("lecture", live_finish=True, transcribe_only=True)
        manager._run(job["id"])
        saved = repo.get("lectures", "lecture")
        assert repo.get("jobs", job["id"])["status"] == "failed"
        assert saved["transcript"] == interim
        assert saved["final_transcription_pending"] is True
        assert all(chunk["status"] == "completed" for chunk in repo.list_chunks("lecture"))

        retry = manager.enqueue("lecture", transcribe_only=True)
        manager._run(retry["id"])
        saved = repo.get("lectures", "lecture")
        assert repo.get("jobs", retry["id"])["status"] == "completed"
        assert saved["transcript"] == final
        assert saved["final_transcription_pending"] is False
        assert [path.name for path in calls] == ["recording.wav", "recording.wav"]
    finally:
        manager.close()


def test_live_finish_cancel_keeps_interim_for_retry(tmp_path, monkeypatch):
    from lecnote import pipeline

    repo = Repository(tmp_path / "library.sqlite3")
    settings = Settings(data_dir=tmp_path)
    interim = _live_recording(repo, settings)
    manager = JobManager(repo, settings, start_worker=False)

    def transcribe(_path, *_args, progress, **_kwargs):
        manager.cancel("lecture")
        progress(50, "Transcribing")
        pytest.fail("Cancellation should stop the full pass")

    monkeypatch.setattr(pipeline, "transcribe", transcribe)
    try:
        job = manager.enqueue("lecture", live_finish=True, transcribe_only=True)
        manager._run(job["id"])
        saved = repo.get("lectures", "lecture")
        assert repo.get("jobs", job["id"])["status"] == "cancelled"
        assert saved["transcript"] == interim
        assert saved["final_transcription_pending"] is True
        assert all(chunk["status"] == "completed" for chunk in repo.list_chunks("lecture"))
    finally:
        manager.close()


def test_legacy_finished_live_recording_gets_one_full_transcription(tmp_path, monkeypatch):
    from lecnote import pipeline
    from lecnote.enrichment import assemble_wav

    repo = Repository(tmp_path / "library.sqlite3")
    settings = Settings(data_dir=tmp_path)
    _live_recording(repo, settings)
    media = settings.lecture_dir("lecture") / "recording.wav"
    assemble_wav([repo_chunk["path"] for repo_chunk in repo.list_chunks("lecture")], media)
    repo.update(
        "lectures",
        "lecture",
        {"status": "draft", "media_path": str(media), "finalized_at": "2026-09-28T00:00:00+00:00"},
    )
    final = {
        "language": "en",
        "duration": 2,
        "segments": [{"id": 0, "start": 0, "end": 2, "text": "The first complete thought", "speaker": None}],
    }
    calls = []

    def transcribe(path, *_args, **_kwargs):
        calls.append(path)
        return final

    monkeypatch.setattr(pipeline, "transcribe", transcribe)
    manager = JobManager(repo, settings, start_worker=False)
    try:
        job = manager.enqueue("lecture", transcribe_only=True)
        manager._run(job["id"])
        assert repo.get("jobs", job["id"])["status"] == "completed"
        assert repo.get("lectures", "lecture")["transcript"] == final
        assert [path.name for path in calls] == ["recording.wav"]
    finally:
        manager.close()


def test_changed_final_transcript_clears_stale_relevance_and_overrides(tmp_path, monkeypatch):
    from lecnote import pipeline

    repo = Repository(tmp_path / "library.sqlite3")
    settings = Settings(data_dir=tmp_path)
    _live_recording(repo, settings)
    old_transcript = {
        "language": "en",
        "duration": 2,
        "segments": [
            {"id": 0, "start": 0, "end": 1, "text": "First", "speaker": None},
            {"id": 1, "start": 1, "end": 2, "text": "Second", "speaker": None},
        ],
    }
    old_relevance = {"fingerprint": "old-analysis"}
    repo.update(
        "lectures",
        "lecture",
        {
            "transcript": old_transcript,
            "relevance": old_relevance,
            "relevance_overrides": {"1": "off_topic"},
        },
    )
    final = {
        "language": "en",
        "duration": 2,
        "segments": [{"id": 0, "start": 0, "end": 2, "text": "First second together", "speaker": None}],
    }
    monkeypatch.setattr(pipeline, "transcribe", lambda *_args, **_kwargs: final)
    manager = JobManager(repo, settings, start_worker=False)
    try:
        job = manager.enqueue("lecture", live_finish=True, transcribe_only=True)
        manager._run(job["id"])
        saved = repo.get("lectures", "lecture")
        assert repo.get("jobs", job["id"])["status"] == "completed"
        assert saved["transcript"] == final
        assert saved["relevance"] is None
        assert saved["relevance_overrides"] == {}
    finally:
        manager.close()


@pytest.mark.parametrize("vanished_id", [False, True])
def test_changed_final_transcript_clears_overrides_before_analysis(tmp_path, monkeypatch, vanished_id):
    from lecnote import pipeline
    from lecnote.relevance import normalize_overrides

    repo = Repository(tmp_path / "library.sqlite3")
    settings = Settings(data_dir=tmp_path)
    _live_recording(repo, settings)
    old_transcript = repo.get("lectures", "lecture")["transcript"]
    if vanished_id:
        old_transcript["segments"].append(
            {"id": 1, "start": 1, "end": 2, "text": "Old ending", "speaker": None}
        )
    repo.update(
        "lectures",
        "lecture",
        {
            "context": "Physics lecture",
            "transcript": old_transcript,
            "relevance": {"fingerprint": "old-analysis"},
            "relevance_overrides": {"1" if vanished_id else "0": "off_topic"},
        },
    )
    final = {
        "language": "en",
        "duration": 2,
        "segments": [{"id": 0, "start": 0, "end": 2, "text": "Actual course material", "speaker": None}],
    }
    monkeypatch.setattr(pipeline, "transcribe", lambda *_args, **_kwargs: final)
    observed = []

    def stop_at_analysis(_transcript, lecture, *_args):
        try:
            overrides = normalize_overrides(lecture, _transcript)
        except ValueError as exc:
            observed.append(str(exc))
        else:
            observed.append((lecture.get("relevance"), lecture.get("relevance_overrides"), overrides))
        raise RuntimeError("Reached analysis without provider calls")

    monkeypatch.setattr(pipeline, "analyze_relevance", stop_at_analysis)
    manager = JobManager(repo, settings, start_worker=False)
    try:
        job = manager.enqueue("lecture", live_finish=True)
        manager._run(job["id"])
        assert observed == [(None, {}, {})]
        assert repo.get("lectures", "lecture")["relevance_overrides"] == {}
    finally:
        manager.close()


def test_speaker_only_transcript_change_preserves_manual_relevance(tmp_path, monkeypatch):
    from lecnote.enrichment import assemble_wav

    repo = Repository(tmp_path / "library.sqlite3")
    settings = Settings(data_dir=tmp_path)
    transcript = _live_recording(repo, settings)
    media = settings.lecture_dir("lecture") / "recording.wav"
    assemble_wav([chunk["path"] for chunk in repo.list_chunks("lecture")], media)
    old_relevance = {"fingerprint": "user-reviewed-analysis"}
    repo.update(
        "lectures",
        "lecture",
        {
            "status": "draft",
            "media_path": str(media),
            "transcript_edited": True,
            "relevance": old_relevance,
            "relevance_overrides": {"0": "course_material"},
        },
    )

    def diarize(_media, segments, _token):
        return [{**segment, "speaker": "Speaker 1"} for segment in segments]

    monkeypatch.setattr("lecnote.enrichment.diarize_segments", diarize)
    manager = JobManager(repo, settings, start_worker=False)
    try:
        job = manager.enqueue("lecture", diarize=True, transcribe_only=True)
        manager._run(job["id"])
        saved = repo.get("lectures", "lecture")
        assert repo.get("jobs", job["id"])["status"] == "completed"
        assert saved["transcript"]["segments"][0]["speaker"] == "Speaker 1"
        assert saved["transcript"]["segments"][0]["text"] == transcript["segments"][0]["text"]
        assert saved["relevance"] == old_relevance
        assert saved["relevance_overrides"] == {"0": "course_material"}
    finally:
        manager.close()


@pytest.mark.parametrize("mode", ["transcribe", "fail", "regenerate"])
def test_existing_notes_survive_until_successful_replacement(tmp_path, mode):
    repo = Repository(tmp_path / "library.sqlite3")
    old = {"title": "Saved notes"}
    repo.create(
        "lectures",
        {"id": "lecture", "status": "ready", "notes": old, "notes_stale": True, "context": "Test topic"},
    )

    def pipeline(*args):
        if mode == "fail":
            raise RuntimeError("Provider unavailable")
        return {
            "transcript": {"duration": 20, "segments": []},
            "notes": {"title": "New notes"} if mode == "regenerate" else None,
        }

    manager = JobManager(repo, Settings(data_dir=tmp_path), pipeline=pipeline, start_worker=False)
    try:
        job = manager.enqueue("lecture", transcribe_only=mode == "transcribe")
        assert repo.get("lectures", "lecture")["notes"] == old
        manager._run(job["id"])
        saved = repo.get("lectures", "lecture")
        assert saved["notes"] == ({"title": "New notes"} if mode == "regenerate" else old)
        assert saved["notes_stale"] is (mode != "regenerate")
    finally:
        manager.close()


@pytest.mark.parametrize("changed", [True, False])
def test_transcription_marks_current_notes_stale_only_when_transcript_changes(tmp_path, changed):
    repo = Repository(tmp_path / "library.sqlite3")
    transcript = {"duration": 20, "segments": []}
    repo.create(
        "lectures",
        {
            "id": "lecture",
            "status": "ready",
            "notes": {"title": "Current"},
            "transcript": transcript,
            "notes_stale": False,
        },
    )

    def pipeline(*args):
        return {"notes": None, "transcript": {**transcript, "duration": 30} if changed else transcript}

    manager = JobManager(repo, Settings(data_dir=tmp_path), pipeline=pipeline, start_worker=False)
    try:
        job = manager.enqueue("lecture", transcribe_only=True)
        manager._run(job["id"])
        assert repo.get("lectures", "lecture")["notes_stale"] is changed
    finally:
        manager.close()

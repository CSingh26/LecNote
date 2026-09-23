import threading
import time

import pytest

from lecnote.config import Settings
from lecnote.db import Repository
from lecnote.jobs import JobManager


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
    repo.create("lectures", {"id": "lecture", "title": "Test", "status": "draft"})
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

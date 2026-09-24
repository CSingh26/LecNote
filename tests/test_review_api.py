import json

from fastapi.testclient import TestClient

from lecnote.api import create_app
from lecnote.config import Settings


def test_manual_relevance_preserves_transcript_and_notes(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path), start_worker=False)) as client:
        lec = client.post(
            "/api/lectures/import",
            json={
                "title": "Inventory",
                "transcript": {
                    "language": "en",
                    "duration": 4,
                    "segments": [{"id": 0, "start": 0, "end": 4, "text": "An example from work"}],
                },
            },
        ).json()
        repo = client.app.state.repo
        notes = {"title": "Keep saved notes"}
        repo.update(
            "lectures",
            lec["id"],
            {
                "notes": notes,
                "relevance": {
                    "segments": [{"segment_id": 0, "category": "off_topic"}],
                    "logistics": [],
                },
            },
        )
        path = f"/api/lectures/{lec['id']}/relevance"
        assert client.put(path, json={"overrides": {"9": "course_material"}}).status_code == 422
        assert client.put(path, json={"overrides": {"0": "invalid"}}).status_code == 422
        response = client.put(path, json={"overrides": {"0": "course_material"}})
        assert response.status_code == 200
        result = response.json()
        assert result["relevance"]["segments"][0]["source"] == "manual"
        assert result["transcript"] == lec["transcript"]
        assert result["notes"] == notes
        assert result["notes_stale"] is True
        assert result["relevance_overrides"] == {"0": "course_material"}
        client.app.state.jobs.enqueue(lec["id"], transcribe_only=True)
        assert client.put(path, json={"overrides": {}}).status_code == 409


def test_recovered_transcript_can_be_classified_after_failure(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path), start_worker=False)) as client:
        lec = client.post(
            "/api/lectures",
            files={"file": ("audio.wav", b"audio")},
            data={"title": "Recovery", "process": "false"},
        ).json()
        transcript = {
            "language": "en",
            "duration": 2,
            "segments": [{"id": 0, "start": 0, "end": 2, "text": "A relevant example"}],
        }
        (tmp_path / "lectures" / lec["id"] / "transcript.json").write_text(json.dumps(transcript))
        response = client.put(
            f"/api/lectures/{lec['id']}/relevance", json={"overrides": {"0": "course_material"}}
        )
        assert response.status_code == 200
        assert client.app.state.repo.get("lectures", lec["id"])["transcript"] == transcript


def test_worker_checkpoints_survive_later_provider_failure(tmp_path, monkeypatch):
    def pipeline(lecture, settings, progress, cancelled, checkpoint):
        checkpoint({"transcript": {"duration": 5, "segments": []}})
        checkpoint({"relevance": {"segments": [], "logistics": []}})
        raise RuntimeError("Simulated provider failure")

    monkeypatch.setattr("lecnote.pipeline.run_pipeline", pipeline)
    with TestClient(create_app(Settings(data_dir=tmp_path), start_worker=False)) as client:
        repo, manager = client.app.state.repo, client.app.state.jobs
        lecture = repo.create("lectures", {"status": "ready", "context": "Assets", "notes": {"title": "Old"}})
        job = manager.enqueue(lecture["id"])
        manager._run(job["id"])
        saved = repo.get("lectures", lecture["id"])
        assert saved["status"] == "failed"
        assert saved["duration"] == 5
        assert saved["relevance"]["segments"] == []
        assert saved["notes"] == {"title": "Old"}

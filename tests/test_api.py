import io
import threading
import wave

import pytest
from fastapi.testclient import TestClient

from lecnote.api import create_app
from lecnote.config import Settings


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path), start_worker=False)
    with TestClient(app) as client:
        yield client


def imported(client, title="Energy lecture"):
    return client.post(
        "/api/lectures/import",
        json={
            "title": title,
            "transcript": {
                "language": "en",
                "duration": 45,
                "segments": [
                    {
                        "id": 0,
                        "start": 10,
                        "end": 25,
                        "text": "Kinetic energy is half mass times velocity squared.",
                        "speaker": None,
                    },
                ],
            },
        },
    )


def test_course_and_lecture_persist_and_search_cites_source(client):
    course = client.post("/api/courses", json={"name": "Physics", "code": "PHY101"}).json()
    lecture = imported(client).json()
    assert client.patch(f"/api/lectures/{lecture['id']}", json={"course_id": course["id"]}).status_code == 200
    results = client.get("/api/search", params={"q": "velocity", "course_id": course["id"]}).json()
    assert results[0]["lecture_id"] == lecture["id"]
    assert results[0]["timestamp"] == 10
    assert results[0]["course_name"] == "Physics"
    assert client.delete(f"/api/courses/{course['id']}").status_code == 409
    assert client.get("/api/courses").json()[0]["lecture_count"] == 1


def test_invalid_transcript_and_missing_course_are_rejected(client):
    assert (
        client.post(
            "/api/lectures/import",
            json={
                "title": "Invalid",
                "transcript": {
                    "language": "en",
                    "duration": 10,
                    "segments": [{"id": 0, "start": 8, "end": 2, "text": "bad"}],
                },
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/lectures/import",
            json={
                "title": "Missing",
                "course_id": "no-course",
                "transcript": {
                    "language": "en",
                    "duration": 10,
                    "segments": [{"id": 0, "start": 0, "end": 10, "text": "text"}],
                },
            },
        ).status_code
        == 404
    )


def test_settings_secrets_never_returned_and_local_origin_required(client):
    result = client.put("/api/settings", json={"api_key": "sk-private-fixture", "model": "custom-model"})
    assert result.status_code == 200
    assert result.json()["api_key_configured"] is True
    assert "sk-private" not in result.text
    assert client.get("/api/settings").json()["model"] == "custom-model"
    blocked = client.post("/api/courses", json={"name": "Attack"}, headers={"Origin": "https://example.org"})
    assert blocked.status_code == 403
    assert client.get("/api/settings", headers={"Origin": "https://example.org"}).status_code == 403
    assert client.put("/api/settings", json={"api_key": ""}).json()["api_key_configured"] is False


def test_upload_uses_server_filename_and_unsupported_file_rejected(client):
    bad = client.post("/api/lectures", files={"file": ("bad.exe", b"x")}, data={"title": "No"})
    assert bad.status_code == 415
    result = client.post(
        "/api/lectures",
        files={"file": ("../../recording.wav", b"RIFF data")},
        data={"title": "Local", "process": "false"},
    )
    assert result.status_code == 201
    item = result.json()
    assert item["source_name"] == "recording.wav"
    assert item["status"] == "draft"
    assert "media_path" not in item
    assert client.get(f"/api/lectures/{item['id']}/media").content == b"RIFF data"


def test_queue_deduplicates_and_cancel_preserves_transcript(client):
    lecture = imported(client).json()
    first = client.post(f"/api/lectures/{lecture['id']}/process", json={}).json()
    second = client.post(f"/api/lectures/{lecture['id']}/process", json={}).json()
    assert first["id"] == second["id"]
    assert client.delete(f"/api/lectures/{lecture['id']}").status_code == 409
    cancelled = client.post(f"/api/lectures/{lecture['id']}/cancel")
    assert cancelled.status_code == 200
    fetched = client.get(f"/api/lectures/{lecture['id']}").json()
    assert fetched["transcript"]["segments"][0]["start"] == 10
    assert fetched["job"]["status"] == "cancelled"


def test_transcript_edit_validates_and_removes_generated_notes(client):
    lecture = imported(client).json()
    repo = client.app.state.repo
    repo.update(
        "lectures",
        lecture["id"],
        {"notes": {"title": "Outdated"}, "status": "ready", "user_notes": "My annotation"},
    )
    new = {
        "language": "en",
        "duration": 30,
        "segments": [{"id": 0, "start": 0, "end": 30, "text": "Corrected statement", "speaker": "Professor"}],
    }
    response = client.put(f"/api/lectures/{lecture['id']}/transcript", json=new)
    assert response.status_code == 200
    assert response.json()["notes"] is None
    assert response.json()["user_notes"] == "My annotation"
    assert client.get("/api/search?q=Corrected").json()[0]["timestamp"] == 0


def test_context_attachment_is_local_and_removable(client):
    lecture = imported(client).json()
    response = client.post(
        f"/api/lectures/{lecture['id']}/attachments", files={"file": ("syllabus.txt", b"Newton, momentum")}
    )
    assert response.status_code == 201
    attachment = response.json()
    assert attachment["text"] == "Newton, momentum"
    assert client.get(attachment["url"]).content == b"Newton, momentum"
    assert client.delete(attachment["url"]).status_code == 204
    assert client.get(attachment["url"]).status_code == 404


def test_live_chunk_is_idempotent_and_rejects_out_of_order_offsets(client):
    live = client.post("/api/live", json={"title": "Live physics"}).json()
    stream = io.BytesIO()
    with wave.open(stream, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * 160)
    endpoint = f"/api/live/{live['id']}/chunks"
    for _ in range(2):
        response = client.post(
            endpoint, files={"file": ("chunk.wav", stream.getvalue())}, data={"sequence": "0", "offset": "0"}
        )
        assert response.status_code == 200
    assert len(client.app.state.repo.list_chunks(live["id"])) == 1
    invalid = client.post(
        endpoint, files={"file": ("chunk.wav", stream.getvalue())}, data={"sequence": "2", "offset": "-1"}
    )
    assert invalid.status_code == 422


def test_delete_removes_lecture_files_without_touching_other_lectures(client):
    first, second = imported(client).json(), imported(client, "Other").json()
    assert client.delete(f"/api/lectures/{first['id']}").status_code == 204
    assert client.get(f"/api/lectures/{first['id']}").status_code == 404
    assert client.get(f"/api/lectures/{second['id']}").status_code == 200


def test_resume_interrupted_recording_assembles_audio_even_with_live_transcript(client):
    lecture = imported(client).json()
    repo = client.app.state.repo
    repo.update("lectures", lecture["id"], {"status": "interrupted"})
    repo.add_chunk(lecture["id"], 0, {"sequence": 0, "path": "saved.wav"})
    result = client.post(f"/api/lectures/{lecture['id']}/process", json={}).json()
    assert repo.get("jobs", result["id"])["live_finish"] is True


def test_completed_transcript_is_available_after_note_failure(client):
    lecture = client.post(
        "/api/lectures", files={"file": ("test.wav", b"audio")}, data={"title": "Saved", "process": "false"}
    ).json()
    import json

    folder = client.app.state.settings.lecture_dir(lecture["id"])
    (folder / "transcript.json").write_text(
        json.dumps(
            {
                "language": "en",
                "duration": 10,
                "segments": [{"id": 0, "start": 0, "end": 10, "text": "Saved speech", "speaker": None}],
            }
        )
    )
    client.app.state.repo.update("lectures", lecture["id"], {"status": "failed", "error": "Missing key"})
    value = client.get(f"/api/lectures/{lecture['id']}").json()
    assert value["transcript"]["segments"][0]["text"] == "Saved speech"
    assert value["duration"] == 10


def test_invalid_json_export_format_is_not_served_as_web_page(client):
    assert client.get("/api/missing-endpoint").status_code == 404
    lecture = imported(client).json()
    assert client.get(f"/api/lectures/{lecture['id']}/export/html").status_code == 409
    assert client.get(f"/api/lectures/{lecture['id']}/export/json").status_code == 200


def test_processing_inherits_speaker_preference_unless_overridden(client):
    client.put("/api/settings", json={"diarization": True})
    first = imported(client).json()
    job = client.post(f"/api/lectures/{first['id']}/process", json={}).json()
    assert job["diarize"] is True
    second = imported(client, "No speakers").json()
    job = client.post(f"/api/lectures/{second['id']}/process", json={"diarize": False}).json()
    assert job["diarize"] is False


@pytest.mark.parametrize("action", ["edit", "delete"])
def test_cancelled_live_inference_cannot_overwrite_a_correction(client, monkeypatch, action):
    live = client.post("/api/live", json={"title": "Live race"}).json()
    identifier = live["id"]
    repo, manager = client.app.state.repo, client.app.state.jobs
    repo.add_chunk(
        identifier, 0, {"sequence": 0, "path": "test.wav", "offset": 0, "duration": 1, "status": "queued"}
    )
    started, release = threading.Event(), threading.Event()

    def inference(*args):
        started.set()
        assert release.wait(3)
        return {
            "language": "en",
            "duration": 1,
            "segments": [{"id": 0, "start": 0, "end": 1, "text": "Original speech", "speaker": None}],
        }

    monkeypatch.setattr("lecnote.transcription.transcribe", inference)
    worker = threading.Thread(target=manager._live, args=(identifier, 0))
    worker.start()
    assert started.wait(3)
    manager.enqueue(identifier, live_finish=True)
    client.post(f"/api/lectures/{identifier}/cancel")
    try:
        if action == "edit":
            response = client.put(
                f"/api/lectures/{identifier}/transcript",
                json={
                    "language": "en",
                    "duration": 1,
                    "segments": [
                        {"id": 0, "start": 0, "end": 1, "text": "Corrected speech", "speaker": "Professor"}
                    ],
                },
            )
            assert response.status_code == 200
        else:
            assert client.delete(f"/api/lectures/{identifier}").status_code == 204
    finally:
        release.set()
        worker.join(3)
    if action == "edit":
        result = client.get(f"/api/lectures/{identifier}").json()
        assert result["transcript"]["segments"][0]["text"] == "Corrected speech"
    else:
        assert client.get(f"/api/lectures/{identifier}").status_code == 404


@pytest.mark.parametrize(
    "segment_end,text", [(10.05, "overrun"), (10, "x" * 16001)], ids=["overrun", "segment-size"]
)
def test_import_rejects_transcripts_outside_processing_constraints(client, segment_end, text):
    response = client.post(
        "/api/lectures/import",
        json={
            "title": "Boundary",
            "transcript": {
                "language": "en",
                "duration": 10,
                "segments": [{"id": 0, "start": 0, "end": segment_end, "text": text}],
            },
        },
    )
    assert response.status_code == 422

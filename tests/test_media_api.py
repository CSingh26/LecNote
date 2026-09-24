import io
import shutil
import threading
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lecnote.api import create_app
from lecnote.config import Settings


def audio():
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * 16000)
    return buffer.getvalue()


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg required for real merge")
def test_merge_api_preserves_sources_and_waits_for_user_context(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path), start_worker=False)) as client:
        course = client.post("/api/courses", json={"name": "ACC502"}).json()
        ids = []
        for title in ["First", "Second"]:
            response = client.post(
                "/api/lectures",
                files={"file": ("recording.wav", audio())},
                data={"title": title, "course_id": course["id"], "process": "false"},
            )
            assert response.status_code == 201
            item = response.json()
            assert item["finalized_at"]
            ids.append(item["id"])
            client.put(
                f"/api/lectures/{item['id']}/transcript",
                json={
                    "language": "en",
                    "duration": 1,
                    "segments": [{"id": 0, "start": 0, "end": 1, "text": title}],
                },
            )
        response = client.post("/api/lectures/merge", json={"title": "Full class", "lecture_ids": ids})
        assert response.status_code == 201, response.text
        merged = response.json()
        assert merged["course_id"] == course["id"]
        assert merged["preparation_ready"] is False
        assert merged["job"] is None
        assert [s["text"] for s in merged["transcript"]["segments"]] == ["First", "Second"]
        assert merged["transcript"]["segments"][1]["start"] == pytest.approx(1, abs=0.1)
        assert client.get(f"/api/lectures/{merged['id']}/media").status_code == 200
        assert client.post(f"/api/lectures/{merged['id']}/process", json={}).status_code == 422
        assert all(client.get(f"/api/lectures/{identifier}/media").content == audio() for identifier in ids)


def test_course_storage_preference_can_return_to_inherited(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path), start_worker=False)) as client:
        course = client.post("/api/courses", json={"name": "ACC502", "optimize_recordings": False}).json()
        response = client.patch(f"/api/courses/{course['id']}", json={"optimize_recordings": None})
        assert response.json()["optimize_recordings"] is None


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg required for real merge")
def test_untranscribed_merge_autoqueues_worker_with_language_autodetect(tmp_path, monkeypatch):
    app = create_app(Settings(data_dir=tmp_path), start_worker=False)
    languages = []

    def transcribe(path, settings, **kwargs):
        languages.append(settings.language)
        assert settings.language == ""
        return {"language": "en", "duration": 2, "segments": [
            {"id": 0, "start": 0, "end": 2, "text": "Recovered lecture"},
        ]}

    monkeypatch.setattr("lecnote.pipeline.transcribe", transcribe)
    with TestClient(app) as client:
        course = client.post("/api/courses", json={"name": "Class"}).json()
        ids = [client.post(
            "/api/lectures", files={"file": ("recording.wav", audio())},
            data={"title": title, "course_id": course["id"], "process": "false"},
        ).json()["id"] for title in ("First", "Second")]
        response = client.post("/api/lectures/merge", json={"title": "Merged", "lecture_ids": ids})
        assert response.status_code == 201, response.text
        merged = response.json()
        assert merged["transcript"] is None
        job = merged["job"]
        assert job["status"] == "queued"
        app.state.jobs._run(job["id"])
        assert languages == [""]
        assert app.state.repo.get("jobs", job["id"])["status"] == "completed"
        saved = app.state.repo.get("lectures", merged["id"])
        assert saved["language"] == ""
        assert saved["transcript"]["segments"][0]["text"] == "Recovered lecture"
        assert saved["partial_transcript"] is None


@pytest.mark.parametrize("cancelled", [False, True])
def test_merge_api_rejects_unrelated_live_recording_without_mutation(tmp_path, monkeypatch, cancelled):
    app = create_app(Settings(data_dir=tmp_path), start_worker=False)
    with TestClient(app) as client:
        course = client.post("/api/courses", json={"name": "Class"}).json()
        ids = [client.post(
            "/api/lectures", files={"file": ("recording.wav", audio())},
            data={"title": title, "course_id": course["id"], "process": "false"},
        ).json()["id"] for title in ("First", "Second")]
        live = client.post("/api/live", json={"title": "Unrelated live lecture"}).json()
        if cancelled:
            app.state.repo.create("jobs", {"lecture_id": live["id"], "status": "running"})
            assert client.post(f"/api/lectures/{live['id']}/cancel").status_code == 200
        before = app.state.repo.list("lectures")
        assert app.state.repo.get("lectures", live["id"])["status"] == "recording"
        originals = {x["media_path"]: Path(x["media_path"]).read_bytes() for x in before if x.get("media_path")}
        jobs = app.state.repo.list("jobs")
        folders = set((tmp_path / "lectures").iterdir())
        monkeypatch.setattr("lecnote.media.MediaService._run",
                            lambda *a, **kw: pytest.fail("FFmpeg started during recording"))
        response = client.post("/api/lectures/merge", json={"title": "Merged", "lecture_ids": ids})
        assert response.status_code == 409, response.text
        assert app.state.repo.list("lectures") == before
        assert app.state.repo.list("jobs") == jobs
        assert set((tmp_path / "lectures").iterdir()) == folders
        assert all(Path(path).read_bytes() == data for path, data in originals.items())


def test_maintenance_skips_all_recording_and_pending_work(tmp_path, monkeypatch):
    app = create_app(Settings(data_dir=tmp_path), start_worker=False)
    with TestClient(app):
        repo, manager = app.state.repo, app.state.jobs
        calls = []
        monkeypatch.setattr("lecnote.media.MediaService.compress_due", lambda *a, **kw: calls.append(kw))
        live = repo.create("lectures", {"status": "recording", "title": "Active"})
        manager._maintenance()
        assert not calls
        repo.update("lectures", live["id"], {"status": "draft"})
        manager._maintenance()
        assert len(calls) == 1


@pytest.mark.parametrize("kind", ["upload", "chunk", "attachment", "resource"])
def test_upload_waiting_for_media_lock_keeps_event_loop_responsive(tmp_path, monkeypatch, kind):
    app = create_app(Settings(data_dir=tmp_path), start_worker=False)
    with TestClient(app) as client, ThreadPoolExecutor() as pool:
        course = client.post("/api/courses", json={"name": "Class"}).json()
        item = client.post("/api/live", json={"title": "Live"}).json()
        if kind != "chunk":
            client.post(f"/api/lectures/{item['id']}/cancel")
        uploaded = threading.Event()
        from lecnote.api import save_upload

        async def observed_upload(*args):
            await save_upload(*args)
            uploaded.set()

        monkeypatch.setattr("lecnote.api.save_upload", observed_upload)
        # resources captured its upload callable when routes were installed.
        if kind == "resource":
            monkeypatch.setattr("lecnote.enrichment.extract_context", lambda path: uploaded.set() or "Text")
        paths = {
            "upload": "/api/lectures",
            "chunk": f"/api/live/{item['id']}/chunks",
            "attachment": f"/api/lectures/{item['id']}/attachments",
            "resource": f"/api/courses/{course['id']}/resources",
        }
        with app.state.jobs.lock:
            pending = pool.submit(
                client.post, paths[kind],
                files={"file": ("audio.wav", audio()) if kind in {"upload", "chunk"} else ("notes.txt", b"Text")},
                data={"title": "Upload", "process": "false", "sequence": "0", "offset": "0"},
            )
            assert uploaded.wait(2)
            health = pool.submit(client.get, "/api/health")
            assert health.result(timeout=1).status_code == 200
            assert not pending.done()
        assert pending.result(timeout=3).status_code in {200, 201}


def test_live_start_rejects_active_compression_and_succeeds_afterward(tmp_path, monkeypatch):
    app = create_app(Settings(data_dir=tmp_path), start_worker=False)
    entered, release = threading.Event(), threading.Event()

    def compress(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        assert not any(x["status"] == "recording" for x in app.state.repo.list("lectures"))

    monkeypatch.setattr("lecnote.media.MediaService.compress_due", compress)
    with TestClient(app) as client, ThreadPoolExecutor() as pool:
        maintenance = pool.submit(app.state.jobs._maintenance)
        assert entered.wait(2)
        try:
            response = client.post("/api/live", json={"title": "Live"})
            assert response.status_code == 409
            assert "media operation" in response.json()["detail"].lower()
        finally:
            release.set()
            maintenance.result(timeout=3)
        assert client.post("/api/live", json={"title": "Live"}).status_code == 201


def test_manual_resegmentation_rebuilds_partial_merge_provenance(tmp_path):
    app = create_app(Settings(data_dir=tmp_path), start_worker=False)
    with TestClient(app) as client:
        item = app.state.repo.create("lectures", {
            "title": "Merged", "status": "draft", "attachments": [],
            "merge_sources": [
                {"lecture_id": "a", "offset": 0, "duration": 1},
                {"lecture_id": "b", "offset": 1, "duration": 1},
            ],
            "segment_sources": [{"segment_id": 0, "source_lecture_id": "b", "source_segment_id": 7}],
        })
        response = client.put(f"/api/lectures/{item['id']}/transcript", json={
            "language": "en", "duration": 2,
            "segments": [{"id": 0, "start": 0, "end": 0.9, "text": "Recovered A"}],
        })
        assert response.status_code == 200
        sources = response.json()["segment_sources"]
        assert sources[0]["source_lecture_id"] == "a"
        assert sources[0].get("source_segment_id") is None


@pytest.mark.parametrize("workspace,course,override,enabled", [
    (False, None, None, False), (True, False, None, False),
    (False, True, None, True), (True, None, False, False), (False, False, True, True),
])
def test_public_media_size_and_effective_compression_do_not_change_saved_state(
    tmp_path, workspace, course, override, enabled,
):
    app = create_app(Settings(data_dir=tmp_path, optimize_recordings=workspace), start_worker=False)
    with TestClient(app) as client:
        course_row = client.post("/api/courses", json={"name": "Class", "optimize_recordings": course}).json()
        item = client.post("/api/lectures", files={"file": ("audio.wav", audio())},
                           data={"title": "Audio", "process": "false", "course_id": course_row["id"]}).json()
        app.state.repo.update("lectures", item["id"], {"optimize_recordings": override})
        before = app.state.repo.get("lectures", item["id"])
        public = client.get(f"/api/lectures/{item['id']}").json()
        assert public["source_bytes"] == len(audio())
        assert "media_path" not in public
        assert public["compression"]["status"] == ("pending" if enabled else "disabled")
        assert app.state.repo.get("lectures", item["id"]) == before
        assert before["compression"]["status"] == "pending"


def test_import_creation_and_course_deletion_are_serialized(tmp_path, monkeypatch):
    app = create_app(Settings(data_dir=tmp_path), start_worker=False)
    entered, release = threading.Event(), threading.Event()
    with TestClient(app) as client, ThreadPoolExecutor() as pool:
        course = client.post("/api/courses", json={"name": "Class"}).json()
        get = app.state.repo.get

        def blocked_check(table, identifier):
            result = get(table, identifier)
            if table == "courses" and identifier == course["id"] and not entered.is_set():
                entered.set()
                assert release.wait(3)
            return result

        monkeypatch.setattr(app.state.repo, "get", blocked_check)
        imported = pool.submit(client.post, "/api/lectures/import", json={
            "title": "Imported", "course_id": course["id"],
            "transcript": {"language": "en", "duration": 1,
                           "segments": [{"id": 0, "start": 0, "end": 1, "text": "Imported text"}]},
        })
        assert entered.wait(2)
        deleted = pool.submit(client.delete, f"/api/courses/{course['id']}")
        try:
            with pytest.raises(TimeoutError):
                deleted.result(timeout=0.2)
        finally:
            release.set()
        assert imported.result(timeout=3).status_code == 201
        assert deleted.result(timeout=3).status_code == 409


def test_process_gate_reads_inputs_only_after_media_lock_handoff(tmp_path, monkeypatch):
    app = create_app(Settings(data_dir=tmp_path), start_worker=False)
    with TestClient(app) as client, ThreadPoolExecutor() as pool:
        item = app.state.repo.create("lectures", {"title": "Audio", "status": "draft", "media_path": "test.wav"})
        read = threading.Event()
        get = app.state.repo.get

        def observed_get(table, identifier):
            if table == "lectures" and identifier == item["id"]:
                read.set()
            return get(table, identifier)

        monkeypatch.setattr(app.state.repo, "get", observed_get)
        with app.state.jobs.lock:
            pending = pool.submit(client.post, f"/api/lectures/{item['id']}/process", json={"transcribe_only": True})
            assert not read.wait(0.2)
            app.state.repo.update("lectures", item["id"], {"status": "recording"})
        assert pending.result(timeout=3).status_code == 409
        assert not app.state.repo.list("jobs")


def test_upload_during_blocked_merge_leaves_health_responsive(tmp_path, monkeypatch):
    app = create_app(Settings(data_dir=tmp_path), start_worker=False)
    entered, release, uploaded = threading.Event(), threading.Event(), threading.Event()
    from lecnote.api import save_upload
    from lecnote.media import MediaBusy

    def merge(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        raise MediaBusy("Test merge stopped")

    async def observed_upload(*args):
        await save_upload(*args)
        uploaded.set()

    monkeypatch.setattr("lecnote.media.MediaService.merge", merge)
    monkeypatch.setattr("lecnote.api.save_upload", observed_upload)
    with TestClient(app) as client, ThreadPoolExecutor() as pool:
        merging = pool.submit(client.post, "/api/lectures/merge", json={"title": "Merge", "lecture_ids": ["a", "b"]})
        assert entered.wait(2)
        pending = pool.submit(client.post, "/api/lectures", files={"file": ("audio.wav", audio())},
                              data={"title": "Upload", "process": "true"})
        try:
            assert uploaded.wait(2)
            assert pool.submit(client.get, "/api/health").result(timeout=1).status_code == 200
            assert not pending.done()
        finally:
            release.set()
        assert merging.result(timeout=3).status_code == 409
        assert pending.result(timeout=3).status_code == 201

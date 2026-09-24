import pytest
from fastapi.testclient import TestClient

from lecnote.api import create_app
from lecnote.config import Settings


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path), start_worker=False)) as client:
        yield client


def lecture(client, course_id=None):
    return client.post(
        "/api/lectures/import",
        json={
            "title": "Inventory",
            "course_id": course_id,
            "transcript": {
                "language": "en",
                "duration": 3,
                "segments": [{"id": 0, "start": 0, "end": 3, "text": "Inventory accounting"}],
            },
        },
    ).json()


def test_note_gate_and_class_resources(client):
    course = client.post("/api/courses", json={"name": "ACC502"}).json()
    base = f"/api/courses/{course['id']}/resources"
    item = client.post(base + "/note", json={"name": "Inventory", "text": "FIFO and LIFO"}).json()
    assert item["revision"] == 1
    assert client.get(base + "?q=LIFO").json()[0]["id"] == item["id"]
    lec = lecture(client, course["id"])
    path = f"/api/lectures/{lec['id']}"
    assert client.post(path + "/process", json={}).status_code == 422
    prepared = client.put(
        path + "/preparation",
        json={
            "context": "",
            "selected_resource_ids": [item["id"]],
        },
    )
    assert prepared.status_code == 200
    assert prepared.json()["preparation_ready"] is True
    assert client.post(path + "/process", json={}).status_code == 200
    assert client.patch(base + "/" + item["id"], json={"text": "Changed"}).status_code == 409
    client.post(path + "/cancel")
    assert client.patch(base + "/" + item["id"], json={"text": "Changed"}).json()["revision"] == 2


def test_cross_class_selection_and_course_move(client):
    course = client.post("/api/courses", json={"name": "ACC502"}).json()
    base = f"/api/courses/{course['id']}/resources"
    item = client.post(base + "/note", json={"name": "Inventory", "text": "FIFO"}).json()
    lec = lecture(client)
    path = f"/api/lectures/{lec['id']}"
    body = {"context": "", "selected_resource_ids": [item["id"]]}
    assert client.put(path + "/preparation", json=body).status_code == 422
    client.patch(path, json={"course_id": course["id"]})
    assert client.put(path + "/preparation", json=body).status_code == 200
    client.patch(path, json={"course_id": None})
    assert client.get(path).json()["selected_resource_ids"] == []
    assert client.get(path).json()["preparation_ready"] is False


def test_upload_delete_and_note_context(client):
    course = client.post("/api/courses", json={"name": "ACC502"}).json()
    base = f"/api/courses/{course['id']}/resources"
    result = client.post(base, files={"file": ("../../syllabus.txt", b"Assets and liabilities")})
    assert result.status_code == 201
    item = result.json()
    assert "path" not in item
    assert client.get(item["url"]).content == b"Assets and liabilities"
    client.patch(base + "/" + item["id"], json={"name": "syllabus.html"})
    assert client.get(item["url"]).headers["content-type"].startswith("text/plain")
    assert client.delete(f"/api/courses/{course['id']}").status_code == 409
    lec = lecture(client, course["id"])
    path = f"/api/lectures/{lec['id']}"
    client.put(path + "/preparation", json={"context": "", "selected_resource_ids": [item["id"]]})
    client.app.state.repo.update("lectures", lec["id"], {"notes": {"title": "Keep"}, "status": "ready"})
    assert client.delete(base + "/" + item["id"]).status_code == 204
    current = client.get(path).json()
    assert current["notes"]["title"] == "Keep"
    assert current["notes_stale"] is True
    assert current["preparation_ready"] is False
    client.put(path + "/preparation", json={"context": "Today covers assets", "selected_resource_ids": []})
    assert client.get(path).json()["preparation_ready"] is True


def test_upload_never_generates_notes_automatically(client):
    response = client.post(
        "/api/lectures",
        files={"file": ("lecture.wav", b"audio")},
        data={"title": "Lecture", "context": "Assets"},
    )
    assert response.status_code == 201
    assert response.json()["job"]["transcribe_only"] is True

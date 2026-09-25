from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lecnote.api import create_app
from lecnote.config import Settings


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(Settings(data_dir=tmp_path), start_worker=False)) as client:
        yield client


@pytest.fixture(params=["resource", "attachment"])
def destination(client, request):
    course = client.post("/api/courses", json={"name": "Files"}).json()
    lecture = client.post(
        "/api/lectures/import",
        json={
            "title": "Files",
            "course_id": course["id"],
            "transcript": {
                "language": "en",
                "duration": 1,
                "segments": [{"id": 0, "start": 0, "end": 1, "text": "Files"}],
            },
        },
    ).json()
    base = (
        f"/api/courses/{course['id']}/resources"
        if request.param == "resource"
        else f"/api/lectures/{lecture['id']}/attachments"
    )
    return base, lecture, request.param


def download_only(path):
    raise RuntimeError("This file is available for download only")


@pytest.mark.parametrize(
    "filename,content",
    [
        ("example.py", b"print('never execute')\n"),
        ("example.js", b"alert(document.cookie)"),
        ("report.docx", b"PK\x03\x04office"),
        ("workbook.xlsx", b"PK\x03\x04spreadsheet"),
        ("deck.pptx", b"PK\x03\x04slides"),
        ("README", b"extensionless original\r\n"),
        ("data.bin", bytes(range(256))),
        ("page.html", b"<script>alert(1)</script>"),
        ("image.svg", b'<svg onload="alert(1)"></svg>'),
        ("fake.note", b"not a typed note"),
    ],
)
def test_arbitrary_upload_preserves_bytes_and_downloads_safely(
    client,
    destination,
    monkeypatch,
    filename,
    content,
):
    monkeypatch.setattr("lecnote.enrichment.extract_context", download_only)
    base, _, _ = destination
    result = client.post(base, files={"file": ("..\\folder/" + filename, content, "text/html")})
    assert result.status_code == 201
    item = result.json()
    assert item["name"] == filename
    assert "path" not in item
    assert item["text"] == ""
    assert item["error"]
    response = client.get(item["url"])
    assert response.content == content
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize(
    "suffix,mime",
    [
        ("txt", "text/plain"),
        ("md", "text/plain"),
        ("pdf", "application/pdf"),
        ("png", "image/png"),
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("webp", "image/webp"),
    ],
)
def test_inline_allowlist_uses_stored_kind(client, destination, monkeypatch, suffix, mime):
    monkeypatch.setattr("lecnote.enrichment.extract_context", download_only)
    base, lecture, kind = destination
    item = client.post(base, files={"file": ("source." + suffix, b"original")}).json()
    if kind == "resource":
        assert client.patch(base + "/" + item["id"], json={"name": "renamed.html"}).status_code == 200
    else:
        repo = client.app.state.repo
        attachments = repo.get("lectures", lecture["id"])["attachments"]
        attachments[0]["name"] = "renamed.html"
        repo.update("lectures", lecture["id"], {"attachments": attachments})
    response = client.get(item["url"])
    assert response.headers["content-type"].split(";")[0] == mime
    assert response.headers["content-disposition"].startswith("inline;")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.content == b"original"


def test_renamed_active_file_stays_download_only(client, destination, monkeypatch):
    monkeypatch.setattr("lecnote.enrichment.extract_context", download_only)
    base, lecture, kind = destination
    content = b"<script>alert(1)</script>"
    response = client.post(base, files={"file": ("active.html", content)})
    assert response.status_code == 201
    item = response.json()
    if kind == "resource":
        assert client.patch(base + "/" + item["id"], json={"name": "safe.pdf"}).status_code == 200
    else:
        repo = client.app.state.repo
        attachments = repo.get("lectures", lecture["id"])["attachments"]
        attachments[0]["name"] = "safe.pdf"
        repo.update("lectures", lecture["id"], {"attachments": attachments})
    response = client.get(item["url"])
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.content == content


def test_readable_upload_keeps_extracted_text(client, destination, monkeypatch):
    monkeypatch.setattr("lecnote.enrichment.extract_context", lambda path: "print('read only')")
    base, _, _ = destination
    response = client.post(base, files={"file": ("example.py", b"print('read only')")})
    assert response.status_code == 201
    assert response.json()["text"] == "print('read only')"
    assert response.json()["error"] is None


@pytest.mark.parametrize("length", [99999, 100000, 100001])
def test_extraction_limit_notice_includes_already_capped_text(client, destination, monkeypatch, length):
    monkeypatch.setattr("lecnote.enrichment.extract_context", lambda path: "x" * length)
    base, _, _ = destination
    response = client.post(base, files={"file": ("example.py", b"original")})
    assert response.status_code == 201
    item = response.json()
    assert item["text"] == "x" * min(length, 100000)
    if length >= 100000:
        assert item["error"] and "100,000" in item["error"]
    else:
        assert item["error"] is None
    original = client.get(item["url"])
    assert original.content == b"original"
    assert original.headers["content-type"] == "application/octet-stream"
    assert original.headers["content-disposition"].startswith("attachment;")


@pytest.mark.parametrize("filename", ["fake.note", "data.bin", "README"])
def test_uploaded_file_cannot_be_edited_or_selected_without_text(client, monkeypatch, filename):
    monkeypatch.setattr("lecnote.enrichment.extract_context", download_only)
    course = client.post("/api/courses", json={"name": "Files"}).json()
    base = f"/api/courses/{course['id']}/resources"
    response = client.post(base, files={"file": (filename, b"original")})
    assert response.status_code == 201
    item = response.json()
    assert client.patch(base + "/" + item["id"], json={"text": "Overwrite"}).status_code == 422
    assert client.patch(base + "/" + item["id"], json={"kind": "txt"}).status_code == 422
    assert client.get(item["url"]).content == b"original"
    lecture = client.post(
        "/api/lectures/import",
        json={
            "title": "Files",
            "course_id": course["id"],
            "transcript": {
                "language": "en",
                "duration": 1,
                "segments": [{"id": 0, "start": 0, "end": 1, "text": "Files"}],
            },
        },
    ).json()
    path = f"/api/lectures/{lecture['id']}"
    result = client.put(path + "/preparation", json={"selected_resource_ids": [item["id"]]})
    assert result.status_code == 422
    assert "no readable text" in result.json()["detail"]
    assert client.get(path).json()["preparation_ready"] is False
    assert client.post(path + "/process", json={}).status_code == 422


@pytest.mark.parametrize("size,status", [(30 * 1024**2, 201), (30 * 1024**2 + 1, 413)])
def test_upload_size_limit_preserved(client, destination, monkeypatch, size, status):
    monkeypatch.setattr("lecnote.enrichment.extract_context", download_only)
    base, _, _ = destination
    result = client.post(base, files={"file": ("large.bin", b"x" * size)})
    assert result.status_code == status
    if status == 201:
        assert len(client.get(result.json()["url"]).content) == size
    else:
        assert not list(Path(client.app.state.settings.data_dir).rglob("*.bin"))

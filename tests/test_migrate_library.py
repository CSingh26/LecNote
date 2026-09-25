import hashlib
import json
import shutil
import sqlite3
from unittest.mock import patch

import pytest

from lecnote.db import Repository
from lecnote.locking import LibraryLock
from lecnote.migrate_library import copy_library


@pytest.fixture
def library(tmp_path):
    root = tmp_path / "original"
    root.mkdir()
    repo = Repository(root / "library.sqlite3")
    (root / "worker.lock").touch()
    folder = root / "lectures" / "lecture"
    folder.mkdir(parents=True)
    audio = folder / "audio.wav"
    audio.write_bytes(b"unchanged original audio")
    material = folder / "example.py"
    material.write_text("print('do not execute')")
    (root / "settings.json").write_text(json.dumps({"api_key": "private-test-key", "model": "custom"}))
    repo.create("courses", {"id": "class", "name": "ACC502"})
    repo.create("lectures", {
        "id": "lecture", "course_id": "class", "status": "ready", "media_path": str(audio),
        "notes": {"overview": "Keep my notes and " + str(root)},
        "transcript": {"segments": [{"text": "Keep my transcript"}]},
        "attachments": [{"path": str(material), "text": "source", "name": "example.py"}],
    })
    repo.add_chunk("lecture", 0, {"path": str(audio), "status": "completed", "segments": []})
    return root, repo


def test_backup_and_container_copy_preserve_records_and_file_hashes(library, tmp_path):
    source, repo = library
    original = repo.get("lectures", "lecture")
    backup = tmp_path / "backup"
    report = copy_library(source, backup)
    assert report["tables"]["lectures"] == 1
    assert report["tables"]["live_chunks"] == 1
    with sqlite3.connect(backup / "library.sqlite3") as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert json.loads(conn.execute("SELECT data FROM lectures").fetchone()[0]) == original
    container = tmp_path / "container"
    copy_library(backup, container, path_root=source, target_root="/data")
    with sqlite3.connect(container / "library.sqlite3") as conn:
        migrated = json.loads(conn.execute("SELECT data FROM lectures").fetchone()[0])
        assert migrated["media_path"] == "/data/lectures/lecture/audio.wav"
        assert migrated["attachments"][0]["path"] == "/data/lectures/lecture/example.py"
        assert migrated["notes"] == original["notes"]
        assert migrated["transcript"] == original["transcript"]
        chunk = json.loads(conn.execute("SELECT data FROM live_chunks").fetchone()[0])
        assert chunk["path"] == "/data/lectures/lecture/audio.wav"
    assert repo.get("lectures", "lecture") == original
    for relative in ("lectures/lecture/audio.wav", "lectures/lecture/example.py", "settings.json"):
        expected = hashlib.sha256((source / relative).read_bytes()).hexdigest()
        assert hashlib.sha256((backup / relative).read_bytes()).hexdigest() == expected
        assert hashlib.sha256((container / relative).read_bytes()).hexdigest() == expected
    assert (container.stat().st_mode & 0o777) == 0o700


def test_refuses_running_library(library, tmp_path):
    source, _ = library
    lock = LibraryLock(source / "worker.lock")
    try:
        with pytest.raises(RuntimeError, match="already open"):
            copy_library(source, tmp_path / "copy")
    finally:
        lock.close()
    assert not (tmp_path / "copy").exists()


def test_corrupt_copy_never_publishes_destination(library, tmp_path):
    source, repo = library
    original = repo.get("lectures", "lecture")

    def corrupt_copy(src, dest):
        dest.write_bytes(b"corrupted")

    with patch("lecnote.migrate_library.shutil.copy2", corrupt_copy):
        with pytest.raises(ValueError, match="verification"):
            copy_library(source, tmp_path / "copy")
    assert not (tmp_path / "copy").exists()
    assert not list(tmp_path.glob(".lecnote-copy-*"))
    assert repo.get("lectures", "lecture") == original


def test_sqlite_backup_includes_wal_and_resource_paths(library, tmp_path):
    source, repo = library
    with sqlite3.connect(source / "library.sqlite3") as writer:
        writer.execute("PRAGMA journal_mode=WAL")
        repo.create("resources", {"id": "file", "path": str(source / "lectures/lecture/example.py")})
        copy_library(source, tmp_path / "copy", target_root="/data")
    with sqlite3.connect(tmp_path / "copy/library.sqlite3") as conn:
        assert json.loads(conn.execute("SELECT data FROM resources").fetchone()[0])["path"] == (
            "/data/lectures/lecture/example.py"
        )


@pytest.mark.parametrize("timing", ["during_copy", "after_backup"])
def test_concurrent_database_change_prevents_publication(library, tmp_path, monkeypatch, timing):
    from lecnote import migrate_library

    source, repo = library
    changed = False

    def edit_notes():
        nonlocal changed
        if not changed:
            repo.update("lectures", "lecture", {"notes": {"overview": "newly saved important notes"}})
            changed = True

    if timing == "during_copy":
        copy = shutil.copy2

        def racing_copy(src, dst):
            copy(src, dst)
            edit_notes()

        monkeypatch.setattr(migrate_library.shutil, "copy2", racing_copy)
    else:
        manifest = migrate_library._manifest

        def racing_manifest(root):
            result = manifest(root)
            if root != source:
                edit_notes()
            return result

        monkeypatch.setattr(migrate_library, "_manifest", racing_manifest)
    with pytest.raises(ValueError, match="[Dd]atabase.*changed"):
        copy_library(source, tmp_path / "copy", target_root="/data")
    assert not (tmp_path / "copy").exists()
    assert repo.get("lectures", "lecture")["notes"]["overview"] == "newly saved important notes"


@pytest.mark.parametrize("table,status", [("lectures", "recording"), ("jobs", "running"), ("jobs", "queued")])
def test_refuses_active_work(library, tmp_path, table, status):
    source, repo = library
    if table == "lectures":
        repo.update(table, "lecture", {"status": status})
    else:
        repo.create(table, {"status": status})
    with pytest.raises(ValueError, match="active"):
        copy_library(source, tmp_path / "copy")
    assert not (tmp_path / "copy").exists()


@pytest.mark.parametrize("mode", ["missing", "external", "symlink", "destination", "nested"])
def test_refuses_unsafe_copy_without_publishing(library, tmp_path, mode):
    source, repo = library
    destination = tmp_path / "copy"
    if mode == "missing":
        (source / "lectures/lecture/audio.wav").unlink()
    elif mode == "external":
        external = tmp_path / "outside.wav"
        external.write_bytes(b"outside")
        repo.update("lectures", "lecture", {"media_path": str(external)})
    elif mode == "symlink":
        (source / "link").symlink_to(source / "settings.json")
    elif mode == "destination":
        destination.mkdir()
        (destination / "keep").write_text("important")
    else:
        destination = source / "copy"
    with pytest.raises((ValueError, FileExistsError)):
        copy_library(source, destination, target_root="/data")
    if mode == "destination":
        assert (destination / "keep").read_text() == "important"
    else:
        assert not destination.exists()

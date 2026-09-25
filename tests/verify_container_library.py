"""Read-only acceptance check against an offline backup and a running container.

No lecture text, credentials, or uploaded contents are printed. This script only
performs GET requests and streams source downloads to compare their checksums.
"""

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from urllib.parse import quote, urlsplit
from urllib.request import urlopen


def check_library(backup, path_root, base):
    parts = urlsplit(base)
    if parts.scheme != "http" or parts.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Verification is restricted to the local container")

    def get(path):
        with urlopen(base.rstrip("/") + path, timeout=30) as response:
            return json.load(response)

    def contains(expected, actual):
        if isinstance(expected, dict):
            assert isinstance(actual, dict)
            for key, value in expected.items():
                contains(value, actual.get(key))
        elif isinstance(expected, list):
            assert isinstance(actual, list) and len(expected) == len(actual)
            for left, right in zip(expected, actual, strict=True):
                contains(left, right)
        else:
            assert expected == actual, "Saved data differs from backup"

    def download_matches(url, raw_path):
        relative = Path(raw_path).relative_to(path_root)
        with (backup / relative).open("rb") as original:
            expected = hashlib.file_digest(original, "sha256").hexdigest()
        digest = hashlib.sha256()
        with urlopen(base.rstrip("/") + url, timeout=60) as response:
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
        assert digest.hexdigest() == expected, "Downloaded file differs from backup"

    with sqlite3.connect((backup / "library.sqlite3").as_uri() + "?mode=ro", uri=True) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        rows = {
            table: [json.loads(row[0]) for row in conn.execute(f'SELECT data FROM "{table}"')]
            for table in ("lectures", "courses", "resources") if table in tables
        }
    courses = {row["id"]: row for row in get("/api/courses")}
    lectures = {row["id"]: row for row in get("/api/lectures")}
    assert set(courses) == {row["id"] for row in rows["courses"]}
    assert set(lectures) == {row["id"] for row in rows["lectures"]}
    downloads = 0
    notes = 0
    for course in rows["courses"]:
        contains(course, courses[course["id"]])
    for lecture in rows["lectures"]:
        route = "/api/lectures/" + quote(lecture["id"], safe="")
        current = get(route)
        for key in ("id", "title", "course_id", "context", "user_notes", "created_at"):
            if key in lecture:
                contains(lecture[key], current.get(key))
        for key in ("notes", "transcript"):
            if lecture.get(key) is not None:
                contains(lecture[key], current.get(key))
        notes += bool(lecture.get("notes"))
        assert len(lecture.get("attachments", [])) == len(current.get("attachments", []))
        for material in lecture.get("attachments", []):
            saved = next(item for item in current["attachments"] if item["id"] == material["id"])
            contains({key: value for key, value in material.items() if key != "path"}, saved)
            download_matches(route + "/attachments/" + quote(material["id"], safe=""), material["path"])
            downloads += 1
        if lecture.get("media_path"):
            download_matches(route + "/media", lecture["media_path"])
            downloads += 1
    for resource in rows.get("resources", []):
        route = "/api/courses/" + quote(resource["course_id"], safe="") + "/resources"
        saved = next(item for item in get(route) if item["id"] == resource["id"])
        contains({key: value for key, value in resource.items() if key != "path"}, saved)
        if resource.get("path"):
            download_matches(route + "/" + quote(resource["id"], safe="") + "/file", resource["path"])
            downloads += 1
    settings = json.loads((backup / "settings.json").read_text())
    current_settings = get("/api/settings")
    for key, value in settings.items():
        if key in {"api_key", "hf_token"}:
            assert current_settings[key + "_configured"] == bool(value)
        elif key != "data_dir":
            contains(value, current_settings.get(key))
    return {"lectures": len(lectures), "courses": len(courses), "saved_notes": notes,
            "verified_downloads": downloads, "settings_preserved": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--path-root", required=True, type=Path)
    parser.add_argument("--url", default="http://127.0.0.1:8872")
    args = parser.parse_args()
    print(json.dumps(check_library(args.backup.resolve(), args.path_root.resolve(), args.url)))

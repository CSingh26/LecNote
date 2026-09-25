"""Verified, offline library copies for backups and container migration."""

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path, PurePosixPath

from .locking import LibraryLock

DATABASE = "library.sqlite3"
SIDECARS = {DATABASE, DATABASE + "-wal", DATABASE + "-shm", DATABASE + "-journal"}


def _digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def _database_digest(conn):
    digest = hashlib.sha256()
    for statement in conn.iterdump():
        digest.update(statement.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _manifest(root):
    files = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("Library contains a symbolic link; resolve it before copying")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError("Library contains a non-regular file")
        relative = path.relative_to(root).as_posix()
        if relative not in SIDECARS:
            files[relative] = {"size": path.stat().st_size, "sha256": _digest(path)}
    return files


def _tables(conn):
    return [row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]


def _quoted(name):
    return '"' + name.replace('"', '""') + '"'


def _records(conn):
    records = {}
    for table in _tables(conn):
        if table in {"courses", "lectures", "jobs", "resources", "live_chunks"}:
            records[table] = [
                (rowid, json.loads(data))
                for rowid, data in conn.execute(f"SELECT rowid, data FROM {_quoted(table)} ORDER BY rowid")
            ]
    return records


def _relocate(record, table, source, path_root, target_root):
    def replace_path(item, key):
        raw = item.get(key)
        if raw is None:
            return
        if not isinstance(raw, str) or not Path(raw).is_absolute():
            raise ValueError("Library has an invalid saved file location")
        try:
            relative = Path(raw).relative_to(path_root)
        except ValueError:
            raise ValueError("A saved file is outside the source library; import it before copying") from None
        if ".." in relative.parts or not (source / relative).is_file():
            raise ValueError("A referenced library file is missing or outside the library")
        if target_root is not None:
            item[key] = str(PurePosixPath(target_root) / relative.as_posix())

    if table == "lectures":
        replace_path(record, "media_path")
        for attachment in record.get("attachments", []):
            replace_path(attachment, "path")
    elif table in {"resources", "live_chunks"}:
        replace_path(record, "path")


def copy_library(source, destination, *, path_root=None, target_root=None):
    """Copy a stopped library, optionally relocating known DB file fields.

    Neither source data nor existing destinations are overwritten. The caller
    must stop the old app before copying and keep it stopped during switchover.
    """
    source = Path(source).expanduser().resolve()
    destination = Path(destination).expanduser().absolute()
    if destination.exists() or destination.is_symlink():
        raise FileExistsError("Destination already exists; choose a new empty location")
    if destination.resolve().is_relative_to(source) or source.is_relative_to(destination.resolve()):
        raise ValueError("Source and destination must be separate library directories")
    if not (source / DATABASE).is_file() or not (source / "worker.lock").is_file():
        raise ValueError("Source must be an existing LecNote library")
    path_root = Path(path_root).expanduser().resolve() if path_root else source
    if target_root is not None:
        target_root = PurePosixPath(target_root)
        if not target_root.is_absolute() or ".." in target_root.parts:
            raise ValueError("Container root must be an absolute, normalized path")
    lock = LibraryLock(source / "worker.lock")
    staging = None
    try:
        with closing(sqlite3.connect((source / DATABASE).as_uri() + "?mode=ro", uri=True)) as original:
            if original.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Source database integrity check failed")
            database_digest = _database_digest(original)
            records = _records(original)
            if any(record.get("status") == "recording" for _, record in records.get("lectures", [])):
                raise ValueError("Library still contains an active recording")
            if any(record.get("status") in {"queued", "running"} for _, record in records.get("jobs", [])):
                raise ValueError("Library still contains active processing jobs")
            manifest = _manifest(source)
            for table, rows in records.items():
                for _, record in rows:
                    _relocate(record, table, source, path_root, target_root)
            destination.parent.mkdir(parents=True, exist_ok=True)
            required = sum(item["size"] for item in manifest.values()) + (source / DATABASE).stat().st_size
            if shutil.disk_usage(destination.parent).free < required + 64 * 1024**2:
                raise ValueError("Not enough free disk space for a verified library copy")
            staging = Path(tempfile.mkdtemp(prefix=".lecnote-copy-", dir=destination.parent))
            for relative in manifest:
                target = staging / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source / relative, target)
            with closing(sqlite3.connect(staging / DATABASE)) as copied:
                original.backup(copied)
                if _database_digest(copied) != database_digest:
                    raise ValueError("Database changed during copying; stop all writers and retry")
                if target_root is not None:
                    for table, rows in records.items():
                        copied.executemany(
                            f"UPDATE {_quoted(table)} SET data=? WHERE rowid=?",
                            [(json.dumps(record), rowid) for rowid, record in rows],
                        )
                    copied.commit()
                if _records(copied) != records:
                    raise ValueError("Database record verification failed")
                if copied.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Copied database integrity check failed")
                tables = {
                    table: copied.execute(f"SELECT COUNT(*) FROM {_quoted(table)}").fetchone()[0]
                    for table in _tables(copied)
                }
                copied.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                copied.execute("PRAGMA journal_mode=DELETE")
        if _manifest(staging) != manifest or _manifest(source) != manifest:
            raise ValueError("File verification failed or the source changed during copying")
        with closing(sqlite3.connect((source / DATABASE).as_uri() + "?mode=ro", uri=True)) as original:
            if _database_digest(original) != database_digest:
                raise ValueError("Database changed during verification; stop all writers and retry")
        if destination.exists() or destination.is_symlink():
            raise FileExistsError("Destination appeared during copying; nothing was overwritten")
        report = {
            "tables": tables,
            "file_count": len(manifest),
            "file_bytes": sum(item["size"] for item in manifest.values()),
            "files": manifest,
            "database_sha256": _digest(staging / DATABASE),
            "source_database_logical_sha256": database_digest,
            "target_root": str(target_root) if target_root is not None else None,
        }
        os.rename(staging, destination)
        staging = None
        return report
    finally:
        if staging is not None:
            shutil.rmtree(staging)
        lock.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--path-root", type=Path, help="Original root stored in a backup's database")
    parser.add_argument("--target-root", help="Container mount path, usually /data")
    parser.add_argument("--report", type=Path, help="New private JSON verification receipt")
    args = parser.parse_args()
    if args.report and args.report.exists():
        parser.error("Report already exists")
    report = copy_library(args.source, args.destination, path_root=args.path_root, target_root=args.target_root)
    if args.report:
        fd = os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump(report, handle, indent=2)
    print(json.dumps({key: value for key, value in report.items() if key != "files"}))


if __name__ == "__main__":
    main()

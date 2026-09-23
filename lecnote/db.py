import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def now():
    return datetime.now(timezone.utc).isoformat()


class Repository:
    TABLES = {"courses", "lectures", "jobs"}

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            for name in self.TABLES:
                conn.execute(f"CREATE TABLE IF NOT EXISTS {name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            conn.execute("""CREATE TABLE IF NOT EXISTS live_chunks (
                lecture_id TEXT NOT NULL, sequence INTEGER NOT NULL, data TEXT NOT NULL,
                PRIMARY KEY (lecture_id, sequence))""")

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=15)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _table(self, table):
        if table not in self.TABLES:
            raise ValueError("Unknown table")
        return table

    def create(self, table, data):
        table = self._table(table)
        item = {"id": str(uuid4()), "created_at": now(), "updated_at": now(), **data}
        with self.connection() as conn:
            conn.execute(f"INSERT INTO {table}(id,data) VALUES (?,?)", (item["id"], json.dumps(item)))
        return item

    def get(self, table, item_id):
        table = self._table(table)
        with self.connection() as conn:
            row = conn.execute(f"SELECT data FROM {table} WHERE id=?", (item_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, table):
        table = self._table(table)
        with self.connection() as conn:
            rows = conn.execute(f"SELECT data FROM {table} ORDER BY rowid DESC").fetchall()
        return [json.loads(row[0]) for row in rows]

    def update(self, table, item_id, values):
        table = self._table(table)
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(f"SELECT data FROM {table} WHERE id=?", (item_id,)).fetchone()
            if not row:
                raise KeyError(item_id)
            item = json.loads(row[0])
            item.update(values)
            item["updated_at"] = now()
            conn.execute(f"UPDATE {table} SET data=? WHERE id=?", (json.dumps(item), item_id))
        return item

    def delete(self, table, item_id):
        table = self._table(table)
        with self.connection() as conn:
            conn.execute(f"DELETE FROM {table} WHERE id=?", (item_id,))

    def add_chunk(self, lecture_id, sequence, values):
        with self.connection() as conn:
            conn.execute("INSERT INTO live_chunks VALUES (?,?,?)", (lecture_id, sequence, json.dumps(values)))

    def update_chunk(self, lecture_id, sequence, values):
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT data FROM live_chunks WHERE lecture_id=? AND sequence=?", (lecture_id, sequence)
            ).fetchone()
            item = json.loads(row[0])
            item.update(values)
            conn.execute(
                "UPDATE live_chunks SET data=? WHERE lecture_id=? AND sequence=?",
                (json.dumps(item), lecture_id, sequence),
            )

    def list_chunks(self, lecture_id):
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT data FROM live_chunks WHERE lecture_id=? ORDER BY sequence", (lecture_id,)
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def delete_chunks(self, lecture_id):
        with self.connection() as conn:
            conn.execute("DELETE FROM live_chunks WHERE lecture_id=?", (lecture_id,))

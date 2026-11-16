"""SQLite storage: long-term memories (user controlled) and chat history."""
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

MAX_MEMORY_LEN = 500
MAX_MESSAGE_LEN = 4000


class MemoryLimitError(Exception):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect(db_path: str):
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db(db_path: str) -> None:
    with connect(db_path) as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute(
            """CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL DEFAULT 'general',
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL CHECK (role IN ('user','rem')),
                content TEXT NOT NULL,
                emotion TEXT,
                created_at TEXT NOT NULL
            )"""
        )


# ---------------------------------------------------------------- memories
def _clean(text: str, limit: int) -> str:
    return " ".join((text or "").split())[:limit]


def add_memory(db_path: str, content: str, category: str = "general", max_memories: int = 200) -> dict:
    content = _clean(content, MAX_MEMORY_LEN)
    category = _clean(category, 40) or "general"
    if not content:
        raise ValueError("Memory text is empty")
    with connect(db_path) as c:
        count = c.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
        if count >= max_memories:
            raise MemoryLimitError(f"Memory limit of {max_memories} reached. Delete some first.")
        now = _now()
        cur = c.execute(
            "INSERT INTO memories (category, content, created_at, updated_at) VALUES (?,?,?,?)",
            (category, content, now, now),
        )
        row = c.execute("SELECT * FROM memories WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)


def list_memories(db_path: str) -> list[dict]:
    with connect(db_path) as c:
        rows = c.execute("SELECT * FROM memories ORDER BY id").fetchall()
    return [dict(r) for r in rows]


def get_memory(db_path: str, memory_id: int) -> dict | None:
    with connect(db_path) as c:
        row = c.execute("SELECT * FROM memories WHERE id=?", (memory_id,)).fetchone()
    return dict(row) if row else None


def update_memory(db_path: str, memory_id: int, content: str | None = None, category: str | None = None) -> dict | None:
    existing = get_memory(db_path, memory_id)
    if not existing:
        return None
    new_content = existing["content"] if content is None else _clean(content, MAX_MEMORY_LEN)
    new_category = existing["category"] if category is None else (_clean(category, 40) or "general")
    if not new_content:
        raise ValueError("Memory text is empty")
    with connect(db_path) as c:
        c.execute(
            "UPDATE memories SET content=?, category=?, updated_at=? WHERE id=?",
            (new_content, new_category, _now(), memory_id),
        )
    return get_memory(db_path, memory_id)


def delete_memory(db_path: str, memory_id: int) -> bool:
    with connect(db_path) as c:
        cur = c.execute("DELETE FROM memories WHERE id=?", (memory_id,))
    return cur.rowcount > 0


# ---------------------------------------------------------------- history
def add_message(db_path: str, role: str, content: str, emotion: str | None = None) -> int:
    with connect(db_path) as c:
        cur = c.execute(
            "INSERT INTO messages (role, content, emotion, created_at) VALUES (?,?,?,?)",
            (role, _clean(content, MAX_MESSAGE_LEN), emotion, _now()),
        )
    return cur.lastrowid


def recent_messages(db_path: str, limit: int) -> list[dict]:
    with connect(db_path) as c:
        rows = c.execute(
            "SELECT * FROM (SELECT * FROM messages ORDER BY id DESC LIMIT ?) ORDER BY id", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def clear_messages(db_path: str) -> int:
    with connect(db_path) as c:
        cur = c.execute("DELETE FROM messages")
    return cur.rowcount

"""Run history in one SQLite file (each run stored as JSON)."""
import sqlite3
import threading
from pathlib import Path

from .models import Run

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "runs.db"
_lock = threading.Lock()


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)")
    return conn


def new_run_id() -> int:
    with _lock, _conn() as conn:
        return conn.execute("INSERT INTO runs (data) VALUES ('{}')").lastrowid


def save(run: Run) -> None:
    with _lock, _conn() as conn:
        conn.execute("UPDATE runs SET data = ? WHERE id = ?", (run.model_dump_json(), run.id))


def get(run_id: int) -> Run | None:
    with _conn() as conn:
        row = conn.execute("SELECT data FROM runs WHERE id = ?", (run_id,)).fetchone()
    return Run.model_validate_json(row[0]) if row and row[0] != "{}" else None


def all_runs() -> list[Run]:
    with _conn() as conn:
        rows = conn.execute("SELECT data FROM runs WHERE data != '{}' ORDER BY id DESC").fetchall()
    return [Run.model_validate_json(r[0]) for r in rows]

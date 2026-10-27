"""Shared fixtures: isolated SQLite/settings files and a scripted fake for ai._tool_call (no real Claude)."""
import pytest

from app import ai, db, settings
from app.models import Run, TestCase, TestResult


class FakeAI:
    """Stands in for ai._tool_call: returns queued (tool name, input) answers and records every call."""

    def __init__(self):
        self.replies: list[tuple[str, dict]] = []
        self.calls: list[dict] = []

    def __call__(self, system, prompt, tools, max_tokens=4000):
        self.calls.append({"system": system, "prompt": prompt, "tools": [t["name"] for t in tools]})
        if not self.replies:
            raise AssertionError("FakeAI: unexpected Claude call (no reply queued)")
        return self.replies.pop(0)


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    """Every test gets its own DB and settings file, and can never reach the real Claude."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "runs.db")
    monkeypatch.setattr(settings, "PATH", tmp_path / "settings.json")

    def no_real_claude(*a, **kw):
        raise AssertionError("real Claude call attempted")

    monkeypatch.setattr(ai, "_cli", no_real_claude)
    monkeypatch.setattr(ai, "client", no_real_claude)


@pytest.fixture
def fake_ai(monkeypatch) -> FakeAI:
    fake = FakeAI()
    monkeypatch.setattr(ai, "_tool_call", fake)
    return fake


@pytest.fixture
def api():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def make_case(case_id: int = 1) -> TestCase:
    return TestCase(id=case_id, title="Add to cart", priority="High",
                    steps=["Open the shop", "Click Add to cart"], expected="Cart shows 1 item")


def make_run(*statuses: str, run_status: str = "Failed") -> Run:
    """A run saved in the DB with one result per status, case ids 1..n."""
    run = Run(id=db.new_run_id(), url="http://localhost:8000/demo/", viewport="Desktop", status=run_status,
              created_at="2026-10-27T10:00:00",
              results=[TestResult(case=make_case(i + 1), status=s) for i, s in enumerate(statuses)])
    db.save(run)
    return run

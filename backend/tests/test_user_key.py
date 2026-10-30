"""The tester's own API key: used for that request/run only, never saved."""
import json

import pytest

from app import ai, db, runner

from .conftest import make_case

KEY = "sk-ant-test-123"
RUN_BODY = {"url": "http://localhost:8000/demo/", "cases": [make_case().model_dump()]}


@pytest.fixture
def started(monkeypatch):
    """Records (run id, key) of every background run instead of opening a browser."""
    calls = []
    monkeypatch.setattr(runner, "run_tests", lambda run_id, key=None: calls.append((run_id, key)))
    return calls


def test_run_gets_the_key_but_it_is_not_saved(api, started):
    run = api.post("/api/runs", json=RUN_BODY, headers={"X-Anthropic-Key": KEY}).json()
    assert started == [(run["id"], KEY)]
    assert KEY not in json.dumps(db.get(run["id"]).model_dump())
    assert KEY not in db.DB_PATH.read_bytes().decode(errors="ignore")


def test_run_without_key_uses_server_provider(api, started):
    run = api.post("/api/runs", json=RUN_BODY).json()
    assert started == [(run["id"], None)]


@pytest.mark.parametrize("bad", ["hello", "sk-proj-abc", "sk-ant-" + "x" * 300])
def test_key_that_is_not_anthropic_is_rejected(api, started, bad):
    res = api.post("/api/runs", json=RUN_BODY, headers={"X-Anthropic-Key": bad})
    assert res.status_code == 400
    assert started == []


def test_public_mode_requires_a_key(api, started, monkeypatch):
    monkeypatch.setattr(ai, "REQUIRE_USER_KEY", True)
    assert api.get("/api/health").json()["needs_key"] is True
    res = api.post("/api/runs", json=RUN_BODY)
    assert res.status_code == 401
    assert started == []


def test_public_mode_never_falls_back_to_server_ai(monkeypatch):
    monkeypatch.setattr(ai, "REQUIRE_USER_KEY", True)
    with pytest.raises(RuntimeError, match="API key"):
        ai._tool_call("sys", "prompt", [ai.BUG_TOOL])


def test_use_key_is_scoped_to_the_block():
    with ai.use_key(KEY):
        assert ai._user_key.get() == KEY
    assert ai._user_key.get() is None


def test_rejected_key_gives_a_clear_401(api, monkeypatch):
    import anthropic
    import httpx

    def reject(*a, **kw):
        resp = httpx.Response(401, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))
        raise anthropic.AuthenticationError("invalid x-api-key", response=resp, body=None)

    monkeypatch.setattr(runner, "read_start_page", lambda url, viewport: "- heading \"Shop\"")
    monkeypatch.setattr(ai, "_tool_call", reject)
    res = api.post("/api/plans", headers={"X-Anthropic-Key": KEY},
                   json={"url": "http://localhost:8000/demo/", "requirements": "A shopper can add a product to the cart."})
    assert res.status_code == 401
    assert "rejected this API key" in res.json()["detail"]
    assert KEY not in res.text

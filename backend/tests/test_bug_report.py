"""The AI bug report is only written for failed tests of finished runs, and only from recorded data."""
import json

import pytest

from app import db

from .conftest import make_run

BUG = {"title": "Coupon SAVE10 returns 500", "severity": "High", "steps": ["Apply SAVE10"], "expected": "10% off",
       "actual": "Error 500", "likely_cause": "Server error in coupon handler", "worth_checking": [],
       "confidence": "Medium"}


def url(run_id, case_id, regenerate=False):
    return f"/api/runs/{run_id}/cases/{case_id}/bug" + ("?regenerate=true" if regenerate else "")


def test_failed_case_gets_report_and_it_is_saved(api, fake_ai):
    run = make_run("Failed")
    fake_ai.replies = [("submit_bug", BUG)]
    resp = api.post(url(run.id, 1))
    assert resp.status_code == 200 and resp.json() == BUG
    assert db.get(run.id).results[0].bug == BUG
    assert fake_ai.calls[0]["tools"] == ["submit_bug"]


@pytest.mark.parametrize("status", ["Passed", "Blocked", "Queued", "Running"])
def test_non_failed_case_gets_no_report(api, fake_ai, status):
    run = make_run(status, run_status="Needs review")
    resp = api.post(url(run.id, 1))
    assert resp.status_code == 400
    assert fake_ai.calls == []


def test_unknown_run_is_404_unknown_case_is_400(api, fake_ai):
    run = make_run("Failed")
    assert api.post(url(9999, 1)).status_code == 404
    assert api.post(url(run.id, 99)).status_code == 400
    assert fake_ai.calls == []


def test_running_run_is_409(api, fake_ai):
    run = make_run("Failed", "Running", run_status="Running")
    assert api.post(url(run.id, 1)).status_code == 409
    assert fake_ai.calls == []


def test_report_is_cached_until_regenerate(api, fake_ai):
    run = make_run("Failed")
    second = {**BUG, "title": "Second take"}
    fake_ai.replies = [("submit_bug", BUG), ("submit_bug", second)]
    assert api.post(url(run.id, 1)).json() == BUG
    assert api.post(url(run.id, 1)).json() == BUG
    assert len(fake_ai.calls) == 1
    assert api.post(url(run.id, 1, regenerate=True)).json() == second
    assert db.get(run.id).results[0].bug == second


def test_report_prompt_has_recorded_data_but_no_screenshot_or_old_bug(api, fake_ai):
    run = make_run("Failed")
    r = run.results[0]
    r.log = ["goto http://localhost:8000/demo/", "fill textbox 'Coupon' = 'SAVE10'"]
    r.network_errors = ["POST http://localhost:8000/demo/api/coupon 500"]
    r.screenshot = "/evidence/1/case_1.png"
    r.bug = {"title": "old report"}
    db.save(run)
    fake_ai.replies = [("submit_bug", BUG)]
    api.post(url(run.id, 1, regenerate=True))
    prompt = fake_ai.calls[0]["prompt"]
    data = json.loads(prompt.split("\n\n", 1)[1])
    assert data["log"] == r.log and data["network_errors"] == r.network_errors
    assert "screenshot" not in data and "bug" not in data
    assert prompt.startswith(f"Target: {run.url}")


def test_only_the_requested_case_gets_a_report(api, fake_ai):
    run = make_run("Failed", "Failed")
    fake_ai.replies = [("submit_bug", BUG)]
    api.post(url(run.id, 2))
    saved = db.get(run.id).results
    assert saved[0].bug is None and saved[1].bug == BUG

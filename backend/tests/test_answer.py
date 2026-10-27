"""Human in the loop: POST .../answer and questions.ask picking the answer up."""
import pytest

from app import db, questions

from .conftest import make_run


def url(run_id, case_id):
    return f"/api/runs/{run_id}/cases/{case_id}/answer"


def waiting_run(answer=None):
    run = make_run("Running", run_status="Running")
    run.results[0].question = {"question": "Which account?", "why": "Login form", "options": ["demo"],
                               "answer": answer}
    db.save(run)
    return run


def test_answer_is_saved(api):
    run = waiting_run()
    resp = api.post(url(run.id, 1), json={"answer": "demo@acme.test"})
    assert resp.status_code == 200 and resp.json() == {"ok": True}
    assert db.get(run.id).results[0].question["answer"] == "demo@acme.test"


def test_skip_saves_skip_marker_whatever_the_text(api):
    run = waiting_run()
    api.post(url(run.id, 1), json={"answer": "ignored", "skip": True})
    assert db.get(run.id).results[0].question["answer"] == questions.SKIP


def test_second_answer_is_409_and_does_not_overwrite(api):
    run = waiting_run()
    api.post(url(run.id, 1), json={"answer": "first"})
    assert api.post(url(run.id, 1), json={"answer": "second"}).status_code == 409
    assert db.get(run.id).results[0].question["answer"] == "first"


def test_not_waiting_is_409(api):
    run = make_run("Running", run_status="Running")  # no question
    assert api.post(url(run.id, 1), json={"answer": "x"}).status_code == 409
    assert api.post(url(9999, 1), json={"answer": "x"}).status_code == 409
    assert api.post(url(run.id, 42), json={"answer": "x"}).status_code == 409


@pytest.mark.parametrize("body", [{"answer": ""}, {"answer": "x" * 501}, {}, {"skip": True}])
def test_invalid_answer_body_is_422(api, body):
    run = waiting_run()
    assert api.post(url(run.id, 1), json=body).status_code == 422
    assert db.get(run.id).results[0].question["answer"] is None


def test_answer_at_max_length_is_accepted(api):
    run = waiting_run()
    assert api.post(url(run.id, 1), json={"answer": "x" * 500}).status_code == 200


# ---------- questions.ask: the runner side ----------

ARGS = {"question": "Which account?", "why": "Login form", "options": ["demo", "admin"]}


def test_ask_waits_for_api_answer_and_logs_it(api, monkeypatch):
    run = make_run("Running", run_status="Running")
    result = run.results[0]
    # While the runner "sleeps", the tester answers through the API.
    monkeypatch.setattr(questions.time, "sleep", lambda s: api.post(url(run.id, 1), json={"answer": "demo"}))
    answer = questions.ask(run, result, ARGS, take_screenshot=lambda name: f"/evidence/{run.id}/{name}")
    assert answer == "demo"
    assert result.question is None
    assert result.log[-1] == "ASKED Which account? -> demo"
    assert db.get(run.id).results[0].question is None


def test_ask_skip_is_logged_as_skipped(api, monkeypatch):
    run = make_run("Running", run_status="Running")
    monkeypatch.setattr(questions.time, "sleep",
                        lambda s: api.post(url(run.id, 1), json={"answer": "-", "skip": True}))
    assert questions.ask(run, run.results[0], ARGS, lambda name: None) == questions.SKIP
    assert run.results[0].log[-1].endswith("(skipped)")


def test_ask_times_out_as_skip(monkeypatch):
    run = make_run("Running", run_status="Running")
    monkeypatch.setattr(questions, "ANSWER_TIMEOUT_S", 0)
    assert questions.ask(run, run.results[0], ARGS, lambda name: None) == questions.SKIP
    assert run.results[0].question is None
    assert "no answer" in run.results[0].log[-1]

"""SQLite run history: save/get round trip, placeholders, ordering."""
from app import db
from app.models import TestResult

from .conftest import make_case, make_run


def test_save_and_get_round_trip():
    run = make_run("Failed", "Passed")
    run.results[0].log = ["goto http://localhost:8000/demo/", "ERROR click {'role': 'button'}: ünïcode ✓"]
    run.results[0].bug = {"title": "Broken", "steps": ["a", "b"]}
    db.save(run)
    assert db.get(run.id) == run


def test_save_overwrites_previous_version():
    run = make_run("Running", run_status="Running")
    run.results[0].status = "Passed"
    run.status = "Passed"
    db.save(run)
    assert db.get(run.id).status == "Passed"
    assert len(db.all_runs()) == 1


def test_get_unknown_id_is_none():
    assert db.get(12345) is None
    assert db.get(0) is None
    assert db.get(-1) is None


def test_new_run_id_placeholder_is_hidden_until_saved():
    run_id = db.new_run_id()
    assert db.get(run_id) is None
    assert db.all_runs() == []


def test_ids_increase_and_all_runs_is_newest_first():
    first, second = make_run("Passed"), make_run("Failed")
    assert second.id > first.id
    assert [r.id for r in db.all_runs()] == [second.id, first.id]


def test_save_of_unknown_id_does_nothing():
    run = make_run("Passed")
    ghost = run.model_copy(update={"id": run.id + 100})
    db.save(ghost)
    assert db.get(ghost.id) is None


def test_creates_missing_data_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "new" / "dir" / "runs.db")
    run = make_run("Passed")
    assert db.get(run.id).results == [TestResult(case=make_case(), status="Passed")]


def test_api_create_get_and_list(api, monkeypatch):
    from app import runner
    monkeypatch.setattr(runner, "run_tests", lambda run_id, key=None: None)  # no browser
    body = {"url": "http://localhost:8000/demo/", "cases": [make_case().model_dump()]}
    created = api.post("/api/runs", json=body).json()
    assert created["status"] == "Running" and created["results"][0]["status"] == "Queued"
    assert api.get(f"/api/runs/{created['id']}").json() == created
    assert api.get("/api/runs").json()[0]["id"] == created["id"]
    assert api.get("/api/runs/999").status_code == 404


def test_api_list_counts_statuses(api):
    make_run("Passed", "Failed", "Blocked", "Passed")
    summary = api.get("/api/runs").json()[0]
    assert (summary["passed"], summary["failed"], summary["blocked"]) == (2, 1, 1)

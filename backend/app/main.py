"""FastAPI app: the endpoints the React frontend calls."""
from datetime import datetime
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv()  # ANTHROPIC_API_KEY, CLAUDE_MODEL from backend/.env — before importing ai

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from . import ai, android, db, demo, questions, runner, settings  # noqa: E402
from .models import Plan, PlanRequest, Run, RunRequest, RunSummary, TestResult  # noqa: E402

app = FastAPI(title="AI QA Agent")
runner.EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/evidence", StaticFiles(directory=runner.EVIDENCE_DIR), name="evidence")
demo.mount(app)  # demo shop at /demo


def user_key(x_anthropic_key: str | None = Header(None)) -> str | None:
    """The tester's own Anthropic key from the "API key" dialog. Used in memory only: never saved or logged."""
    key = (x_anthropic_key or "").strip() or None
    if key and (not key.startswith("sk-ant-") or len(key) > 300):
        raise HTTPException(400, "That does not look like an Anthropic API key (sk-ant-…)")
    if ai.REQUIRE_USER_KEY and not key:
        raise HTTPException(401, "Add your Anthropic API key first")
    return key


@app.exception_handler(anthropic.AuthenticationError)
def bad_key(request, exc):
    return JSONResponse({"detail": "Anthropic rejected this API key — check it and add it again"}, status_code=401)


@app.get("/api/health")
def health():
    return {"ok": True, "provider": ai.PROVIDER, "model": ai.MODEL, "needs_key": ai.REQUIRE_USER_KEY}


@app.post("/api/plans", response_model=Plan)
def create_plan(req: PlanRequest, x_anthropic_key: str | None = Header(None)):
    key = user_key(x_anthropic_key)
    try:
        if req.platform == "android":
            page = android.start_screen(req.url)
        else:
            page = runner.read_start_page(req.url, req.viewport)
    except Exception as e:
        raise HTTPException(400, f"Could not open {req.url}: {str(e).splitlines()[0]}")
    with ai.use_key(key):
        return Plan(cases=ai.generate_plan(req.url, req.requirements, page, req.platform))


@app.post("/api/runs", response_model=Run)
def create_run(req: RunRequest, background: BackgroundTasks, x_anthropic_key: str | None = Header(None)):
    key = user_key(x_anthropic_key)
    run = Run(
        id=db.new_run_id(),
        platform=req.platform,
        url=req.url,
        viewport=req.viewport,
        clear_data=req.clear_data,
        status="Running",
        created_at=datetime.now().isoformat(timespec="seconds"),
        results=[TestResult(case=c) for c in req.cases],
    )
    db.save(run)
    # frontend polls GET /api/runs/{id}
    if run.platform == "android":
        background.add_task(android.run_tests, run.id, runner.EVIDENCE_DIR, key)
    else:
        background.add_task(runner.run_tests, run.id, key)
    return run


@app.get("/api/android/devices")
def android_devices():
    return {"devices": android.devices()}


@app.get("/api/runs", response_model=list[RunSummary])
def list_runs():
    return [
        RunSummary(
            id=r.id, platform=r.platform, url=r.url, status=r.status, created_at=r.created_at,
            passed=sum(x.status == "Passed" for x in r.results),
            failed=sum(x.status == "Failed" for x in r.results),
            blocked=sum(x.status == "Blocked" for x in r.results),
        )
        for r in db.all_runs()
    ]


@app.get("/api/runs/{run_id}", response_model=Run)
def get_run(run_id: int):
    run = db.get(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@app.post("/api/runs/{run_id}/cases/{case_id}/bug")
def create_bug_report(run_id: int, case_id: int, regenerate: bool = False,
                      x_anthropic_key: str | None = Header(None)):
    """Writes (once) and saves the AI bug report for a failed test; regenerate=true writes a new one."""
    key = user_key(x_anthropic_key)
    run = db.get(run_id)
    result = next((r for r in run.results if r.case.id == case_id), None) if run else None
    if not result or result.status != "Failed":
        raise HTTPException(400, "Only failed tests get a bug report")
    if run.status == "Running":
        raise HTTPException(409, "Wait until the run has finished")
    if result.bug is None or regenerate:
        data = result.model_dump(exclude={"bug", "screenshot"})
        with ai.use_key(key):
            result.bug = ai.bug_report(run.url, data)
        db.save(run)
    return result.bug


class Answer(BaseModel):
    answer: str = Field(min_length=1, max_length=500)
    skip: bool = False


@app.post("/api/runs/{run_id}/cases/{case_id}/answer")
def answer_question(run_id: int, case_id: int, body: Answer):
    """The tester's answer to a running test's question; the runner picks it up within a few seconds."""
    run = db.get(run_id)
    result = next((r for r in run.results if r.case.id == case_id), None) if run else None
    if not result or not result.question or result.question.get("answer") is not None:
        raise HTTPException(409, "This test is not waiting for an answer")
    result.question["answer"] = questions.SKIP if body.skip else body.answer
    db.save(run)
    return {"ok": True}


@app.get("/api/settings", response_model=settings.Settings)
def get_settings():
    return settings.load()


@app.put("/api/settings", response_model=settings.Settings)
def put_settings(body: settings.Settings):
    return settings.save(body)


# Built frontend (npm run build) served at / so one server is enough for deploy. Mounted last.
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

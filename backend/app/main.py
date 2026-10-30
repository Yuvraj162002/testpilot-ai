"""FastAPI app: the endpoints the React frontend calls."""
import asyncio
import re
from datetime import datetime
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv()  # ANTHROPIC_API_KEY, CLAUDE_MODEL from backend/.env — before importing ai

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request, Response  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from . import access, ai, android, db, demo, questions, runner, settings  # noqa: E402
from .models import Plan, PlanRequest, Run, RunRequest, RunSummary, TestResult  # noqa: E402

# Public mode hides the API docs: no need to hand out a map of the endpoints.
app = FastAPI(title="AI QA Agent", **({"docs_url": None, "redoc_url": None, "openapi_url": None} if access.PUBLIC else {}))
runner.EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
demo.mount(app)  # demo shop at /demo
EVIDENCE_NAME = re.compile(r"[A-Za-z0-9_-]+\.png")
for _run in db.all_runs():  # runs cut off by a restart or redeploy
    db.stop_unfinished(_run.id, "The server restarted during this run.")

OPEN_PATHS = {"/api/health", "/api/login", "/api/logout"}


@app.middleware("http")
async def access_gate(request: Request, call_next):
    """Public mode: API and screenshots need a valid access code (cookie). Ownership is checked per run in own_run."""
    request.state.owner = ""  # local: one owner, everything visible as before
    path = request.url.path
    if access.PUBLIC and path.startswith(("/api/", "/evidence/")) and path not in OPEN_PATHS \
            and not path.startswith("/api/admin/"):
        code = request.cookies.get(access.COOKIE)
        if not access.label(code):
            return JSONResponse({"detail": "Enter your access code"}, status_code=403)
        request.state.owner = access.owner_of(code)
    return await call_next(request)


def own_run(request: Request, run_id: int) -> Run:
    run = db.get(run_id) if 0 < run_id < 2**62 else None
    if not run or run.owner != request.state.owner:
        raise HTTPException(404, "Run not found")
    return run


@app.get("/evidence/{run_id}/{name}")
def evidence(run_id: int, name: str, request: Request):
    """A run's screenshot, only for the code that owns the run. Plain file names only (no paths)."""
    own_run(request, run_id)
    path = runner.EVIDENCE_DIR / str(run_id) / name
    if not EVIDENCE_NAME.fullmatch(name) or not path.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(path)


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
    return {"ok": True, "provider": ai.PROVIDER, "model": ai.MODEL, "needs_key": ai.REQUIRE_USER_KEY,
            "public": access.PUBLIC}


# ---------- access codes (public mode) ----------

class Login(BaseModel):
    code: str = Field(min_length=1, max_length=100)


@app.post("/api/login")
async def login(body: Login, response: Response):
    code = body.code.strip()
    name = access.label(code)
    if not name:
        await asyncio.sleep(access.FAIL_DELAY_S)  # async: guessing must not tie up worker threads
        raise HTTPException(403, "That access code is not valid")
    response.set_cookie(access.COOKIE, code, max_age=7 * 24 * 3600, httponly=True, samesite="lax", secure=access.PUBLIC)
    return {"label": name}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(access.COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    return {"label": access.label(request.cookies.get(access.COOKIE)) if access.PUBLIC else None}


async def admin(x_admin_password: str | None) -> None:
    if not access.is_admin(x_admin_password):
        await asyncio.sleep(access.FAIL_DELAY_S)
        raise HTTPException(403, "Wrong admin password")


class NewCode(BaseModel):
    label: str = Field(min_length=1, max_length=60)


class Revoke(BaseModel):
    code: str = Field(min_length=1, max_length=100)


@app.get("/api/admin/codes")
async def list_codes(x_admin_password: str | None = Header(None)):
    await admin(x_admin_password)
    return access.codes()


@app.post("/api/admin/codes")
async def create_code(body: NewCode, x_admin_password: str | None = Header(None)):
    await admin(x_admin_password)
    return access.new_code(body.label)


@app.post("/api/admin/codes/revoke")  # code in the body, not the URL, so it stays out of access logs
async def revoke_code(body: Revoke, x_admin_password: str | None = Header(None)):
    await admin(x_admin_password)
    try:
        access.revoke(body.code)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


def check_target(req) -> None:
    if access.PUBLIC and req.platform == "android":
        raise HTTPException(400, "Android testing is only available when you run Testara on your own computer")
    if req.platform == "web" and (why := access.blocked(req.url)):
        raise HTTPException(400, f"Can't test {req.url}: {why}")


@app.post("/api/plans", response_model=Plan)
def create_plan(req: PlanRequest, x_anthropic_key: str | None = Header(None)):
    key = user_key(x_anthropic_key)
    check_target(req)
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
def create_run(req: RunRequest, request: Request, background: BackgroundTasks,
               x_anthropic_key: str | None = Header(None)):
    key = user_key(x_anthropic_key)
    check_target(req)
    owner = request.state.owner
    if access.PUBLIC and any(r.owner == owner and r.status == "Running" for r in db.all_runs()):
        raise HTTPException(409, "You already have a test run in progress — wait for it to finish")
    run = Run(
        id=db.new_run_id(),
        platform=req.platform,
        url=req.url,
        viewport=req.viewport,
        clear_data=req.clear_data,
        status="Running",
        created_at=datetime.now().isoformat(timespec="seconds"),
        results=[TestResult(case=c) for c in req.cases],
        owner=owner,
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
    if access.PUBLIC:
        return {"devices": []}
    return {"devices": android.devices()}


@app.get("/api/runs", response_model=list[RunSummary])
def list_runs(request: Request):
    return [
        RunSummary(
            id=r.id, platform=r.platform, url=r.url, status=r.status, created_at=r.created_at,
            passed=sum(x.status == "Passed" for x in r.results),
            failed=sum(x.status == "Failed" for x in r.results),
            blocked=sum(x.status == "Blocked" for x in r.results),
        )
        for r in db.all_runs() if r.owner == request.state.owner
    ]


@app.get("/api/runs/{run_id}", response_model=Run)
def get_run(run_id: int, request: Request):
    return own_run(request, run_id)


@app.post("/api/runs/{run_id}/cases/{case_id}/bug")
def create_bug_report(run_id: int, case_id: int, request: Request, regenerate: bool = False,
                      x_anthropic_key: str | None = Header(None)):
    """Writes (once) and saves the AI bug report for a failed test; regenerate=true writes a new one."""
    key = user_key(x_anthropic_key)
    run = own_run(request, run_id)
    result = next((r for r in run.results if r.case.id == case_id), None)
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
def answer_question(run_id: int, case_id: int, body: Answer, request: Request):
    """The tester's answer to a running test's question; the runner picks it up within a few seconds."""
    run = own_run(request, run_id)
    result = next((r for r in run.results if r.case.id == case_id), None)
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
    if access.PUBLIC:  # shared server: one tester must not change how everyone's runs behave
        raise HTTPException(403, "Settings are fixed on the hosted version")
    return settings.save(body)


# Built frontend (npm run build) served at / so one server is enough for deploy. Mounted last.
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

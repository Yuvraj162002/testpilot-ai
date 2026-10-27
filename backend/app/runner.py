"""Runs approved test cases in a real Chromium browser and records what happened."""
import time
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import Page, sync_playwright

from . import ai, db, questions, settings
from .models import VIEWPORTS, Run, TestResult

EVIDENCE_DIR = Path(__file__).resolve().parent.parent / "runs"
MAX_ACTIONS = 15  # per test case
SNAPSHOT_CHARS = 12000
ACTION_TIMEOUT_MS = 5000


def _norm(text: str) -> str:
    return " ".join(text.split()).lower()


def _is_noise(text: str) -> bool:
    """Browser errors that are never the site's bug (missing favicon, its generic 404 console line)."""
    return "favicon" in text or text == "Failed to load resource: the server responded with a status of 404 (Not Found)"


def _browser(p, headless: bool = True):
    try:
        return p.chromium.launch(channel="chrome", headless=headless)
    except Exception:  # no Google Chrome -> Playwright's own Chromium
        return p.chromium.launch(headless=headless)


def settle(page: Page) -> None:
    """Wait until the page stops loading (slow SPAs render after the URL changes), max ~5 s."""
    try:
        page.wait_for_load_state("networkidle", timeout=5000)
    except Exception:
        pass  # pages with live connections never go idle — fall through after the timeout
    page.wait_for_timeout(500)


def snapshot(page: Page) -> str:
    try:
        return page.locator("body").aria_snapshot()[:SNAPSHOT_CHARS]
    except Exception:
        return page.inner_text("body")[:SNAPSHOT_CHARS]


def read_start_page(url: str, viewport: str) -> str:
    """Accessibility snapshot of the start page, used to write a plan that fits the site."""
    w, h = VIEWPORTS[viewport]
    with sync_playwright() as p:
        browser = _browser(p)
        page = browser.new_page(viewport={"width": w, "height": h})
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(1500)
        text = snapshot(page)
        browser.close()
    return text


def _do(page: Page, name: str, args: dict, base_url: str) -> str:
    if name == "click":
        page.get_by_role(args["role"], name=args["name"]).first.click(timeout=ACTION_TIMEOUT_MS)
        return f"click {args['role']} '{args['name']}'"
    if name == "fill":
        box = page.get_by_role(args["role"], name=args["name"]).first
        box.fill("", timeout=ACTION_TIMEOUT_MS)
        # Type key by key like a person, so search-as-you-type and validation listeners fire.
        box.press_sequentially(args["value"], delay=60, timeout=ACTION_TIMEOUT_MS)
        return f"fill {args['role']} '{args['name']}' = '{args['value']}'"
    if name == "press":
        page.keyboard.press(args["key"])
        return f"press {args['key']}"
    if name == "goto":
        page.goto(urljoin(base_url, args["url"]), wait_until="domcontentloaded", timeout=30000)
        return f"goto {page.url}"
    raise ValueError(f"unknown action {name}")


def _run_case(browser, run: Run, result: TestResult, out: Path, cfg: settings.Settings) -> None:
    """One attempt of one test case in a fresh browser context; fills `result` in place."""
    w, h = VIEWPORTS[run.viewport]
    result.log, result.console_errors, result.network_errors, result.reason = [], [], [], ""
    ctx = browser.new_context(viewport={"width": w, "height": h})  # fresh cookies per case
    page = ctx.new_page()
    if cfg.console_logs:
        page.on("console", lambda m: m.type == "error" and not _is_noise(m.text) and result.console_errors.append(m.text))
    if cfg.network_errors:
        page.on("response", lambda resp: resp.status >= 400 and not _is_noise(resp.url)
                and result.network_errors.append(f"{resp.request.method} {resp.url} {resp.status}"))
        page.on("requestfailed", lambda req: result.network_errors.append(f"{req.method} {req.url} failed: {req.failure}"))
    try:
        page.goto(run.url, wait_until="domcontentloaded", timeout=30000)
        result.log.append(f"goto {page.url}")
        for _ in range(MAX_ACTIONS):
            settle(page)
            name, args = ai.next_action(result.case, page.url, result.log, snapshot(page), can_ask=cfg.ask_when_unsure)
            if name == "ask_user":
                def shot(fname: str) -> str | None:
                    page.screenshot(path=str(out / fname))
                    return f"/evidence/{run.id}/{fname}"
                if questions.ask(run, result, args, shot) == questions.SKIP:
                    result.status, result.reason = "Blocked", f"Skipped by the tester at: {args['question']}"
                    break
                continue
            if name == "finish":
                result.status, result.reason = args["status"], args["reason"]
                # The verdict must be backed by the real page, not just the AI's word.
                # Visible text + accessible names (icon-only buttons have a name but no text).
                page_text = _norm(page.inner_text("body") + "\n" + snapshot(page))
                missing = [e for e in args.get("evidence") or [] if _norm(e) not in page_text]
                if result.status == "Passed" and missing:
                    result.status = "Blocked"
                    result.reason = f"Needs review: AI said passed but {missing} is not on the page."
                break
            try:
                result.log.append(_do(page, name, args, run.url))
            except Exception as e:  # tell the AI, let it try something else or fail the test
                result.log.append(f"ERROR {name} {args}: {str(e).splitlines()[0]}")
        else:
            result.status, result.reason = "Blocked", f"No verdict after {MAX_ACTIONS} actions."
    except Exception as e:
        result.status, result.reason = "Blocked", f"Could not run: {str(e).splitlines()[0]}"
    result.final_url = page.url
    if cfg.screenshots:
        shot = out / f"case_{result.case.id}.png"
        try:
            page.screenshot(path=str(shot))
            result.screenshot = f"/evidence/{run.id}/{shot.name}"
        except Exception:
            pass
    ctx.close()


def run_tests(run_id: int) -> None:
    """Background job: executes every case of the run, saving progress after each one."""
    run: Run = db.get(run_id)
    cfg = settings.load()
    out = EVIDENCE_DIR / str(run_id)
    out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = _browser(p)
        for result in run.results:
            result.status = "Running"
            db.save(run)
            started = time.monotonic()
            _run_case(browser, run, result, out, cfg)
            if result.status == "Failed" and cfg.retry_failed:
                first = result.reason
                result.attempts = 2
                _run_case(browser, run, result, out, cfg)
                if result.status != "Failed":
                    result.reason = f"Flaky: failed on the first try ({first}), then {result.status.lower()} on retry. " + result.reason
            result.duration_s = round(time.monotonic() - started, 1)
            db.save(run)
        browser.close()

    statuses = {r.status for r in run.results}
    run.status = "Failed" if "Failed" in statuses else "Needs review" if "Blocked" in statuses else "Passed"
    db.save(run)

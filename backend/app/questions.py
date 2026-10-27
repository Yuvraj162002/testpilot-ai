"""Human in the loop: a running test can stop and ask the user (answered on the Results screen)."""
import time
from datetime import datetime
from typing import Callable

from . import db
from .models import Run, TestResult

ANSWER_TIMEOUT_S = 15 * 60
SKIP = "__skip__"  # answer sent by "Skip this test"

ASK_TOOL = {
    "name": "ask_user",
    "description": (
        "Pause the test and ask the human tester. Use it when you are unsure what to do (unexpected dialog, "
        "two possible paths), when you need data you don't have (test account, password, OTP, code), when "
        "you can't tell if what you see is correct or a bug, and before an action that changes real data "
        "(submit/send a form, register, delete, pay) unless the test steps explicitly ask for that action."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "question": {"type": "string", "description": "Short, clear question in plain language"},
            "why": {"type": "string", "description": "What you see on the screen that made you ask"},
            "options": {"type": "array", "items": {"type": "string"},
                        "description": "2-4 concrete answers the tester can pick with one click. No 'Other' option: "
                                       "the tester can always type a free answer or skip the test."},
        },
        "required": ["question", "why", "options"],
    },
}


def ask(run: Run, result: TestResult, args: dict, take_screenshot: Callable[[str], str | None]) -> str:
    """Store the question, wait for the answer from the UI, return it (SKIP if skipped or timed out)."""
    result.question = {
        "question": args["question"],
        "why": args.get("why", ""),
        "options": args.get("options") or [],
        "screenshot": take_screenshot(f"case_{result.case.id}_q{len(result.log)}.png"),
        "asked_at": datetime.now().isoformat(timespec="seconds"),
        "answer": None,
    }
    db.save(run)
    deadline = time.monotonic() + ANSWER_TIMEOUT_S
    while time.monotonic() < deadline:
        time.sleep(1.5)
        fresh = db.get(run.id)
        saved = next(r for r in fresh.results if r.case.id == result.case.id).question
        if saved and saved.get("answer") is not None:
            answer = saved["answer"]
            result.question = None
            result.log.append(f"ASKED {args['question']} -> {'(skipped)' if answer == SKIP else answer}")
            db.save(run)
            return answer
    result.question = None
    result.log.append(f"ASKED {args['question']} -> (no answer in {ANSWER_TIMEOUT_S // 60} min)")
    return SKIP

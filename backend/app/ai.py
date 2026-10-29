"""Everything that talks to Claude: test plan, next browser action, bug report.

Two providers (AI_PROVIDER in .env):
  claude-cli  the user's own Claude Code login via `claude -p` — no API key, no extra cost (default)
  api         Anthropic API with ANTHROPIC_API_KEY
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

from .models import TestCase
from .questions import ASK_TOOL

PROVIDER = os.getenv("AI_PROVIDER") or ("api" if os.getenv("ANTHROPIC_API_KEY") else "claude-cli")
MODEL = os.getenv("CLAUDE_MODEL") or ("sonnet" if PROVIDER == "claude-cli" else "claude-sonnet-5-5")
CLI_TIMEOUT_S = 180
# Empty working dir outside the repo: `claude -p` also reads CLAUDE.md from parent folders, so a dir inside
# the repo would feed our dev instructions to the test agent.
CLI_CWD = Path(tempfile.gettempdir()) / "testpilot-claude-cli"
_client = None


def client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment
    return _client


def _cli(system: str, prompt: str, schema: dict | None = None) -> dict | str:
    """One `claude -p` call with tools disabled; returns the structured output (or text without a schema)."""
    CLI_CWD.mkdir(parents=True, exist_ok=True)
    cmd = ["claude", "-p", prompt, "--output-format", "json", "--tools", "", "--no-session-persistence",
           "--system-prompt", system, "--model", MODEL]
    if schema:
        cmd += ["--json-schema", json.dumps(schema)]
    proc = subprocess.run(cmd, cwd=CLI_CWD, capture_output=True, text=True, timeout=CLI_TIMEOUT_S)
    try:
        out = json.loads(proc.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"claude CLI failed: {(proc.stderr or proc.stdout).strip()[:300]}"
                           " — is Claude Code installed and logged in (`claude` in a terminal)?")
    if out.get("is_error"):
        raise RuntimeError(f"claude CLI error: {str(out.get('result'))[:300]}")
    return out.get("structured_output") if schema else out.get("result", "")


def _tool_call(system: str, prompt: str, tools: list[dict], max_tokens: int = 4000) -> tuple[str, dict]:
    """Ask Claude and force it to answer through one of `tools`; returns (tool name, input)."""
    if PROVIDER == "claude-cli":
        if len(tools) == 1:
            return tools[0]["name"], _cli(system, prompt, tools[0]["input_schema"])
        menu = "\n".join(f"- {t['name']}: {t['description']} args: {json.dumps(t['input_schema']['properties'])}"
                         for t in tools)
        schema = {"type": "object", "required": ["action", "args"], "properties": {
            "action": {"type": "string", "enum": [t["name"] for t in tools]}, "args": {"type": "object"}}}
        out = _cli(system, f"{prompt}\n\nAvailable actions (answer with action + args):\n{menu}", schema)
        return out["action"], out["args"]
    msg = client().messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=system,
        tools=tools,
        tool_choice={"type": "any"},
        messages=[{"role": "user", "content": prompt}],
    )
    block = next(b for b in msg.content if b.type == "tool_use")
    return block.name, block.input


# ---------- 1. Requirements -> test plan ----------

PLAN_TOOL = {
    "name": "submit_plan",
    "description": "Submit the test plan.",
    "input_schema": {
        "type": "object",
        "properties": {
            "cases": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "priority": {"type": "string", "enum": ["High", "Medium", "Low"]},
                        "steps": {"type": "array", "items": {"type": "string"}},
                        "expected": {"type": "string"},
                    },
                    "required": ["title", "priority", "steps", "expected"],
                },
            }
        },
        "required": ["cases"],
    },
}


def generate_plan(url: str, requirements: str, page_snapshot: str, platform: str = "web") -> list[TestCase]:
    what = "mobile app test cases for the given Android app" if platform == "android" else \
        "browser test cases for the given website"
    system = (
        f"You are a senior QA engineer. Turn the user's requirements into 4-10 concrete {what}. "
        "Each case: short title, priority, 2-6 user-level steps, and one observable expected result "
        "(something visible on the screen). Only test what the requirements ask for. Each test starts fresh "
        "from the app/site start screen."
    )
    prompt = (
        f"{'App' if platform == 'android' else 'Website'}: {url}\n\nRequirements:\n{requirements}\n\n"
        f"Elements on the start screen (truncated):\n{page_snapshot}"
    )
    _, data = _tool_call(system, prompt, [PLAN_TOOL])
    return [TestCase(id=i + 1, **c) for i, c in enumerate(data["cases"])]


# ---------- 2. One test case -> browser actions, one at a time ----------

_TARGET = {
    "role": {"type": "string", "description": "ARIA role from the snapshot, e.g. button, link, textbox"},
    "name": {"type": "string", "description": "Accessible name from the snapshot"},
}
ACTION_TOOLS = [
    {"name": "click", "description": "Click an element.",
     "input_schema": {"type": "object", "properties": _TARGET, "required": ["role", "name"]}},
    {"name": "fill", "description": "Type into a text field (replaces its value).",
     "input_schema": {"type": "object", "properties": {**_TARGET, "value": {"type": "string"}},
                      "required": ["role", "name", "value"]}},
    {"name": "press", "description": "Press a keyboard key, e.g. Enter.",
     "input_schema": {"type": "object", "properties": {"key": {"type": "string"}}, "required": ["key"]}},
    {"name": "goto", "description": "Open a URL or a path on the same site.",
     "input_schema": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}},
    {"name": "finish", "description": "End the test with a verdict.",
     "input_schema": {"type": "object", "properties": {
         "status": {"type": "string", "enum": ["Passed", "Failed", "Blocked"]},
         "reason": {"type": "string", "description": "What you observed that proves the verdict"},
         "evidence": {"type": "array", "items": {"type": "string"},
                      "description": "1-3 short snippets copied exactly from the current page that support the "
                                     "verdict, each one a single piece of text (not joined together). "
                                     "Required for Passed: without it the test is marked for review."},
     }, "required": ["status", "reason"]}},
]

ACTION_SYSTEM = (
    "You are executing one browser test case step by step. You see the current page as an accessibility "
    "snapshot and the actions done so far. Pick exactly ONE next action. Use role and name exactly as they "
    "appear in the snapshot. When the expected result is clearly met call finish with Passed; when it is "
    "clearly not met (error shown, wrong page, missing element) call finish with Failed; if the test cannot "
    "start because of something unrelated (site down, login wall without credentials) call finish with Blocked. "
    "Every step must really happen: if a step does not work (a click changes nothing, a panel or page that "
    "should appear does not), call finish with Failed right away — never Passed because the end state happens "
    "to look right. "
    "Form fields the steps don't give a value for (name, email, address, phone): type made-up test data such as "
    "\"test@example.com\", \"Test User\", \"123 Test Street\" — never real personal details."
)


ANDROID_TOOLS = [
    {"name": "tap", "description": "Tap an element by its [number].",
     "input_schema": {"type": "object", "properties": {"element": {"type": "integer"}}, "required": ["element"]}},
    {"name": "type", "description": "Tap a text field by its [number], clear it and type text.",
     "input_schema": {"type": "object", "properties": {"element": {"type": "integer"}, "text": {"type": "string"}},
                      "required": ["element", "text"]}},
    {"name": "scroll", "description": "Scroll the screen to see more.",
     "input_schema": {"type": "object", "properties": {"direction": {"type": "string", "enum": ["down", "up"]}},
                      "required": ["direction"]}},
    {"name": "back", "description": "Press the Android back button.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "enter", "description": "Press Enter on the keyboard (submit a search).",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "wait", "description": "Wait 3 seconds for loading.",
     "input_schema": {"type": "object", "properties": {}}},
    ACTION_TOOLS[-1],  # finish
]

ANDROID_SYSTEM = (
    "You are executing one test case on an Android app, step by step. You see the current screen as a "
    "numbered list of elements ([n] type \"label\" (tap/input)). Pick exactly ONE next action, using the "
    "element number. Permission or system dialogs: allow them unless the test says otherwise. When the expected "
    "result is clearly met call finish with Passed; when it is clearly not met (error, crash, wrong screen, "
    "missing element) call finish with Failed; if the test cannot start for an unrelated reason call finish "
    "with Blocked. Evidence must be labels copied exactly from the element list. "
    "Every step must really happen: if a step does not work (a click changes nothing, a panel or page that "
    "should appear does not), call finish with Failed right away — never Passed because the end state happens "
    "to look right. "
    "Form fields the steps don't give a value for (name, email, address, phone): type made-up test data such as "
    "\"test@example.com\", \"Test User\", \"123 Test Street\" — never real personal details."
)


def next_action(case: TestCase, url: str, history: list[str], snapshot: str,
                platform: str = "web", can_ask: bool = False) -> tuple[str, dict]:
    where = "App package" if platform == "android" else "Current URL"
    prompt = (
        f"Test case: {case.title}\nSteps:\n" + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(case.steps))
        + f"\nExpected result: {case.expected}\n\n{where}: {url}\n\n"
        + "Done so far:\n" + ("\n".join(history[-15:]) or "(nothing yet)")
        + f"\n\nCurrent page snapshot (truncated):\n{snapshot}"
    )
    extra = [ASK_TOOL] if can_ask else []
    note = ("\n\nLines starting with ASKED are the tester's answers to your questions — follow them. "
            "Do not ask the same question twice." if can_ask else "")
    if platform == "android":
        return _tool_call(ANDROID_SYSTEM + note, prompt, ANDROID_TOOLS + extra, max_tokens=1000)
    return _tool_call(ACTION_SYSTEM + note, prompt, ACTION_TOOLS + extra, max_tokens=1000)


# ---------- 3. Failed result -> bug report ----------

BUG_TOOL = {
    "name": "submit_bug",
    "description": "Submit the bug report.",
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "One line: what is broken, where"},
            "severity": {"type": "string", "enum": ["Critical", "High", "Medium", "Low"]},
            "steps": {"type": "array", "items": {"type": "string"},
                      "description": "Steps to reproduce, from the execution log, in plain user language"},
            "expected": {"type": "string"},
            "actual": {"type": "string", "description": "What really happened, only from the data"},
            "likely_cause": {"type": "string", "description": "Best guess at the cause — clearly a guess"},
            "worth_checking": {"type": "array", "items": {"type": "string"}},
            "confidence": {"type": "string", "enum": ["High", "Medium", "Low"],
                           "description": "How sure the likely cause is"},
        },
        "required": ["title", "severity", "steps", "expected", "actual", "likely_cause", "worth_checking",
                     "confidence"],
    },
}


def bug_report(site: str, result: dict) -> dict:
    """Structured bug report from a failed test. Evidence itself is shown from the real data, not from here."""
    system = (
        "You are a senior QA engineer writing a bug report from a failed automated test. Use only the data "
        "given (test case, execution log, verdict, console/network/app errors). Never invent evidence, URLs, "
        "error messages or steps that are not in the data. The likely cause is a hypothesis for developers."
    )
    prompt = f"Target: {site}\n\n{json.dumps(result, indent=2)}"
    return _tool_call(system, prompt, [BUG_TOOL], max_tokens=2000)[1]

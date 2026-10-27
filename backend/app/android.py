"""Android driver: runs test cases on an emulator/phone through adb (no Appium needed).

The screen is read with `uiautomator dump` (Flutter exposes its Semantics there), turned into a numbered
list of elements; the AI picks an element number and we tap its centre with `adb shell input`.
"""
import glob
import hashlib
import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from . import ai, db, questions, settings
from .models import Run

SDK = Path(os.getenv("ANDROID_HOME", Path.home() / "Android" / "Sdk"))
# Prefer the SDK's adb: a different system adb version fights over the same server port.
ADB = os.getenv("ADB") or (str(SDK / "platform-tools" / "adb") if (SDK / "platform-tools" / "adb").exists() else "adb")
MAX_ACTIONS = 15
SNAPSHOT_LINES = 150


def adb(*args: str, timeout: int = 60, serial: str | None = None) -> str:
    cmd = [ADB] + (["-s", serial] if serial else []) + list(args)
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args[:3])}: {(proc.stderr or proc.stdout).strip()[:200]}")
    return proc.stdout


def devices() -> list[str]:
    try:
        out = adb("devices", timeout=10)
    except Exception:
        return []
    return [line.split()[0] for line in out.splitlines()[1:] if line.strip().endswith("device")]


def package_name(apk: str) -> str:
    aapt = sorted(glob.glob(str(SDK / "build-tools" / "*" / "aapt")))
    if not aapt:
        raise RuntimeError("aapt not found — install Android SDK build-tools or set ANDROID_HOME")
    out = subprocess.run([aapt[-1], "dump", "badging", apk], capture_output=True, text=True, timeout=60).stdout
    match = re.search(r"package: name='([^']+)'", out)
    if not match:
        raise RuntimeError(f"Could not read the package name from {apk}")
    return match.group(1)


@dataclass
class Element:
    n: int
    label: str
    kind: str
    clickable: bool
    editable: bool
    center: tuple[int, int]


def read_screen(serial: str) -> list[Element]:
    """Screen elements; retries because `uiautomator dump` hangs while a slow device is busy."""
    for attempt in range(3):
        try:
            adb("shell", "uiautomator", "dump", "/sdcard/qa_ui.xml", serial=serial, timeout=25)
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3)
    xml = adb("exec-out", "cat", "/sdcard/qa_ui.xml", serial=serial)
    elements = _parse(xml)
    # A system "isn't responding" dialog is the device being slow, not the app: wait and read again.
    wait = next((e for e in elements if e.label == "Wait"), None)
    if wait and any("isn't responding" in e.label or "isn’t responding" in e.label for e in elements):
        adb("shell", "input", "tap", str(wait.center[0]), str(wait.center[1]), serial=serial)
        time.sleep(3)
        return read_screen(serial)
    return elements


def _parse(xml: str) -> list[Element]:
    elements: list[Element] = []
    for node in ET.fromstring(xml[xml.index("<"):]).iter("node"):
        label = " ".join(filter(None, [node.get("text"), node.get("content-desc")])).strip()
        clickable = node.get("clickable") == "true" or node.get("long-clickable") == "true"
        editable = "EditText" in (node.get("class") or "")
        if not label and not clickable and not editable:
            continue
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.get("bounds") or "[0,0][0,0]"))
        if x2 <= x1 or y2 <= y1:
            continue
        kind = (node.get("class") or "").split(".")[-1]
        elements.append(Element(len(elements) + 1, label.replace("\n", " "), kind, clickable, editable,
                                ((x1 + x2) // 2, (y1 + y2) // 2)))
    return elements


def describe(elements: list[Element]) -> str:
    lines = []
    for e in elements[:SNAPSHOT_LINES]:
        flags = ", ".join(f for f, on in [("tap", e.clickable), ("input", e.editable)] if on)
        lines.append(f"[{e.n}] {e.kind} \"{e.label}\"" + (f" ({flags})" if flags else ""))
    return "\n".join(lines) or "(screen has no readable elements — maybe still loading)"


def _type_text(serial: str, text: str) -> None:
    # `input text` needs spaces as %s and shell-special characters escaped.
    escaped = re.sub(r"([\\'\"`$&|;<>()*?!#~])", r"\\\1", text).replace(" ", "%s")
    adb("shell", "input", "text", escaped, serial=serial)


def _do(serial: str, name: str, args: dict, elements: list[Element]) -> str:
    by_n = {e.n: e for e in elements}
    if name in ("tap", "type"):
        e = by_n.get(int(args["element"]))
        if not e:
            raise ValueError(f"no element [{args['element']}] on screen")
        adb("shell", "input", "tap", str(e.center[0]), str(e.center[1]), serial=serial)
        if name == "tap":
            return f"tap [{e.n}] {e.kind} '{e.label}'"
        time.sleep(0.5)
        adb("shell", "input", "keyevent", "KEYCODE_MOVE_END", serial=serial)
        adb("shell", "input", "keyevent", "--longpress", *["KEYCODE_DEL"] * 40, serial=serial)  # clear
        _type_text(serial, args["text"])
        return f"type [{e.n}] '{e.label}' = '{args['text']}'"
    if name == "back":
        adb("shell", "input", "keyevent", "KEYCODE_BACK", serial=serial)
        return "back"
    if name == "enter":
        adb("shell", "input", "keyevent", "KEYCODE_ENTER", serial=serial)
        return "enter"
    if name == "scroll":
        size = re.findall(r"\d+", adb("shell", "wm", "size", serial=serial))[-2:]
        w, h = int(size[0]), int(size[1])
        y1, y2 = (int(h * 0.75), int(h * 0.3)) if args["direction"] == "down" else (int(h * 0.3), int(h * 0.75))
        adb("shell", "input", "swipe", str(w // 2), str(y1), str(w // 2), str(y2), "400", serial=serial)
        return f"scroll {args['direction']}"
    if name == "wait":
        time.sleep(3)
        return "wait 3s"
    raise ValueError(f"unknown action {name}")


def _launch(serial: str, package: str, clear_data: bool) -> None:
    adb("shell", "am", "force-stop", package, serial=serial)
    if clear_data:  # every test starts like a fresh install (onboarding, logged out)
        adb("shell", "pm", "clear", package, serial=serial)
    adb("shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1", serial=serial)
    time.sleep(6)  # Flutter cold start + splash


def _app_errors(serial: str, package: str) -> list[str]:
    """Errors the app logged during the test (Flutter exceptions, crashes)."""
    try:
        pid = adb("shell", "pidof", package, serial=serial).strip()
    except Exception:
        pid = ""
    args = ["logcat", "-d", "*:E"] + ([f"--pid={pid}"] if pid else [])
    lines = adb(*args, serial=serial, timeout=30).splitlines()
    keep = [l for l in lines if pid and pid in l or "FATAL" in l or "flutter" in l.lower()]
    return [re.sub(r"^\S+ \S+\s+\d+\s+\d+ ", "", l)[:300] for l in keep][-20:]


def start_screen(apk: str) -> str:
    """Install + open the app and describe its first screen (used to write the test plan)."""
    serial = _serial()
    package = install(apk, serial)
    _launch(serial, package, clear_data=True)
    return describe(read_screen(serial))


def install(apk: str, serial: str) -> str:
    """Install the APK unless exactly this file is already on the device (big APKs take minutes over adb)."""
    if not Path(apk).is_file():
        raise RuntimeError(f"APK not found: {apk}")
    package = package_name(apk)
    try:
        remote = adb("shell", "pm", "path", package, serial=serial).split("package:")[1].split()[0]
        same = adb("shell", "sha256sum", remote, serial=serial).split()[0] == _sha256(apk)
    except Exception:
        same = False  # not installed yet
    if not same:
        adb("install", "-r", "-d", apk, serial=serial, timeout=900)
    return package


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _serial() -> str:
    found = devices()
    if not found:
        raise RuntimeError("No Android device — start an emulator (Android Studio > Device Manager) or plug in a phone")
    return found[0]


def run_tests(run_id: int, evidence_dir: Path) -> None:
    run: Run = db.get(run_id)
    cfg = settings.load()
    out = evidence_dir / str(run_id)
    out.mkdir(parents=True, exist_ok=True)
    try:
        serial = _serial()
        package = install(run.url, serial)
    except Exception as e:
        for result in run.results:
            result.status, result.reason = "Blocked", f"Could not start: {e}"
        run.status = "Needs review"
        db.save(run)
        return

    for result in run.results:
        result.status = "Running"
        db.save(run)
        started = time.monotonic()
        try:
            try:
                adb("logcat", "-c", serial=serial)  # so the errors below belong to this test only
            except Exception:
                pass  # sometimes fails right after boot; errors may then include older lines
            _launch(serial, package, clear_data=run.clear_data)
            result.log.append(f"launch {package}" + (" (fresh data)" if run.clear_data else ""))
            for _ in range(MAX_ACTIONS):
                time.sleep(1.5)
                elements = read_screen(serial)
                name, args = ai.next_action(result.case, package, result.log, describe(elements), platform="android",
                                            can_ask=cfg.ask_when_unsure)
                if name == "ask_user":
                    def shot(fname: str) -> str | None:
                        (out / fname).write_bytes(subprocess.run([ADB, "-s", serial, "exec-out", "screencap", "-p"],
                                                                 capture_output=True, timeout=30).stdout)
                        return f"/evidence/{run.id}/{fname}"
                    if questions.ask(run, result, args, shot) == questions.SKIP:
                        result.status, result.reason = "Blocked", f"Skipped by the tester at: {args['question']}"
                        break
                    continue
                if name == "finish":
                    result.status, result.reason = args["status"], args["reason"]
                    screen_text = ai_norm(" ".join(e.label for e in elements))
                    missing = [e for e in args.get("evidence") or [] if ai_norm(e) not in screen_text]
                    if result.status == "Passed" and missing:
                        result.status = "Blocked"
                        result.reason = f"Needs review: AI said passed but {missing} is not on the screen."
                    break
                try:
                    result.log.append(_do(serial, name, args, elements))
                except Exception as e:
                    result.log.append(f"ERROR {name} {args}: {str(e).splitlines()[0]}")
            else:
                result.status, result.reason = "Blocked", f"No verdict after {MAX_ACTIONS} actions."
            if cfg.console_logs:
                result.console_errors = _app_errors(serial, package)
        except Exception as e:
            result.status, result.reason = "Blocked", f"Could not run: {str(e).splitlines()[0]}"
        shot = out / f"case_{result.case.id}.png"
        try:
            if not cfg.screenshots:
                raise RuntimeError("screenshots off")
            shot.write_bytes(subprocess.run([ADB, "-s", serial, "exec-out", "screencap", "-p"],
                                            capture_output=True, timeout=30).stdout)
            result.screenshot = f"/evidence/{run_id}/{shot.name}"
        except Exception:
            pass
        result.duration_s = round(time.monotonic() - started, 1)
        db.save(run)

    statuses = {r.status for r in run.results}
    run.status = "Failed" if "Failed" in statuses else "Needs review" if "Blocked" in statuses else "Passed"
    db.save(run)


def ai_norm(text: str) -> str:
    return " ".join(text.split()).lower()

"""Workspace settings (Settings screen), stored in backend/data/settings.json."""
import json
from pathlib import Path

from pydantic import BaseModel

from .models import Platform, Viewport

PATH = Path(__file__).resolve().parent.parent / "data" / "settings.json"


class Settings(BaseModel):
    default_platform: Platform = "web"
    default_viewport: Viewport = "Desktop"
    screenshots: bool = True  # screenshot at the end of every test
    console_logs: bool = True  # browser console errors / Android logcat errors
    network_errors: bool = True  # failed requests and 4xx/5xx responses (web)
    retry_failed: bool = False  # run a failed test once more to filter out flaky results
    ask_when_unsure: bool = True  # the AI may pause a test and ask the tester (Results screen dialog)


def load() -> Settings:
    try:
        return Settings.model_validate_json(PATH.read_text())
    except (FileNotFoundError, ValueError):
        return Settings()


def save(s: Settings) -> Settings:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps(s.model_dump(), indent=2))
    return s

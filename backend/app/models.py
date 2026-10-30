"""Request/response shapes shared by the API, the AI and the runner."""
from typing import Literal

from pydantic import BaseModel, Field, model_validator

Priority = Literal["High", "Medium", "Low"]
Viewport = Literal["Desktop", "Tablet", "Mobile"]
Status = Literal["Queued", "Running", "Passed", "Failed", "Blocked"]
RunStatus = Literal["Running", "Passed", "Failed", "Needs review"]
Platform = Literal["web", "android"]

VIEWPORTS = {"Desktop": (1440, 900), "Tablet": (768, 1024), "Mobile": (390, 844)}


class TestCase(BaseModel):
    id: int
    title: str
    priority: Priority
    steps: list[str]
    expected: str


class Target(BaseModel):
    """What to test: a website URL, or an APK path on this machine for Android."""
    platform: Platform = "web"
    url: str = Field(min_length=1)  # web: https://… ; android: /path/to/app.apk
    viewport: Viewport = "Desktop"  # web only
    clear_data: bool = True  # android only: start every test like a fresh install

    @model_validator(mode="after")
    def _check_url(self):
        if self.platform == "web" and not self.url.startswith(("http://", "https://")):
            raise ValueError("Enter a full URL starting with http:// or https://")
        if self.platform == "android" and not self.url.endswith(".apk"):
            raise ValueError("Enter the path of an .apk file")
        return self


class PlanRequest(Target):
    requirements: str = Field(min_length=20, max_length=2000)


class Plan(BaseModel):
    cases: list[TestCase]


class RunRequest(Target):
    cases: list[TestCase] = Field(min_length=1)


class TestResult(BaseModel):
    case: TestCase
    status: Status = "Queued"
    duration_s: float | None = None
    reason: str = ""  # AI's verdict text; the log below is what actually happened
    log: list[str] = []
    screenshot: str | None = None  # URL under /evidence
    console_errors: list[str] = []
    network_errors: list[str] = []
    final_url: str = ""  # web: where the browser was when the test ended
    attempts: int = 1  # 2 when "retry failed tests once" ran it again
    bug: dict | None = None  # saved AI bug report (see ai.BUG_TOOL)
    question: dict | None = None  # open question to the tester while the test waits (see questions.py)


class Run(BaseModel):
    id: int
    platform: Platform = "web"
    url: str
    viewport: Viewport
    clear_data: bool = True
    status: RunStatus
    created_at: str
    results: list[TestResult]
    owner: str = ""  # public mode: hash of the access code that started it (access.owner_of)


class RunSummary(BaseModel):
    id: int
    platform: Platform = "web"
    url: str
    status: RunStatus
    created_at: str
    passed: int
    failed: int
    blocked: int

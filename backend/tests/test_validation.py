"""Input validation: target URL / APK path, requirements length, run cases."""
import pytest
from pydantic import ValidationError

from app.models import PlanRequest, RunRequest, Target, TestCase

from .conftest import make_case

REQ = "Users can add a product to the cart and check out."


@pytest.mark.parametrize("url", ["http://localhost:8000/demo/", "https://example.com", "https://example.com/a?b=1"])
def test_web_accepts_http_and_https(url):
    assert Target(url=url).url == url


@pytest.mark.parametrize("url", ["example.com", "www.example.com", "ftp://example.com", "javascript:alert(1)",
                                 "file:///etc/passwd", " https://example.com", "/app.apk"])
def test_web_rejects_non_http_urls(url):
    with pytest.raises(ValidationError, match="http:// or https://"):
        Target(url=url)


def test_empty_url_is_rejected():
    with pytest.raises(ValidationError):
        Target(url="")


def test_android_accepts_apk_path():
    assert Target(platform="android", url="/home/me/app-debug.apk").url.endswith(".apk")


@pytest.mark.parametrize("url", ["https://example.com", "/home/me/app.zip", "/home/me/app.apk.zip", "/home/me/apk"])
def test_android_rejects_non_apk(url):
    with pytest.raises(ValidationError, match=r"\.apk"):
        Target(platform="android", url=url)


def test_unknown_platform_and_viewport_are_rejected():
    with pytest.raises(ValidationError):
        Target(platform="ios", url="https://example.com")
    with pytest.raises(ValidationError):
        Target(url="https://example.com", viewport="Watch")


def test_requirements_length_bounds():
    PlanRequest(url="https://example.com", requirements="x" * 20)
    PlanRequest(url="https://example.com", requirements="x" * 2000)
    for bad in ["", "x" * 19, "x" * 2001]:
        with pytest.raises(ValidationError):
            PlanRequest(url="https://example.com", requirements=bad)


def test_run_needs_at_least_one_case():
    assert len(RunRequest(url="https://example.com", cases=[make_case()]).cases) == 1
    with pytest.raises(ValidationError):
        RunRequest(url="https://example.com", cases=[])


def test_test_case_priority_must_be_known():
    with pytest.raises(ValidationError):
        TestCase.model_validate({**make_case().model_dump(), "priority": "Urgent"})


# ---------- Same checks through the API (422, nothing opened, no Claude call) ----------

@pytest.mark.parametrize("body", [
    {"url": "example.com", "requirements": REQ},
    {"url": "https://example.com", "requirements": "too short"},
    {"url": "https://example.com", "requirements": "x" * 2001},
    {"platform": "android", "url": "/tmp/app.zip", "requirements": REQ},
    {"requirements": REQ},
])
def test_plan_api_rejects_bad_input(api, fake_ai, monkeypatch, body):
    from app import runner
    monkeypatch.setattr(runner, "read_start_page", lambda *a: pytest.fail("page opened for invalid input"))
    assert api.post("/api/plans", json=body).status_code == 422
    assert fake_ai.calls == []


def test_run_api_rejects_bad_input(api):
    case = make_case().model_dump()
    assert api.post("/api/runs", json={"url": "ftp://x", "cases": [case]}).status_code == 422
    assert api.post("/api/runs", json={"url": "https://example.com", "cases": []}).status_code == 422
    assert api.get("/api/runs").json() == []  # nothing was saved


def test_plan_api_returns_numbered_cases(api, fake_ai, monkeypatch):
    from app import runner
    monkeypatch.setattr(runner, "read_start_page", lambda url, viewport: '- button "Add to cart"')
    fake_ai.replies = [("submit_plan", {"cases": [
        {"title": "Add item", "priority": "High", "steps": ["Click Add to cart"], "expected": "1 item"},
        {"title": "Remove item", "priority": "Low", "steps": ["Click Remove"], "expected": "Cart is empty"},
    ]})]
    resp = api.post("/api/plans", json={"url": "https://example.com", "requirements": REQ})
    assert resp.status_code == 200
    assert [c["id"] for c in resp.json()["cases"]] == [1, 2]
    assert 'button "Add to cart"' in fake_ai.calls[0]["prompt"]


def test_plan_api_site_that_does_not_open_is_400(api, fake_ai, monkeypatch):
    from app import runner

    def down(*a):
        raise RuntimeError("net::ERR_NAME_NOT_RESOLVED at https://nope.invalid\nCall log: ...")

    monkeypatch.setattr(runner, "read_start_page", down)
    resp = api.post("/api/plans", json={"url": "https://nope.invalid", "requirements": REQ})
    assert resp.status_code == 400
    assert "ERR_NAME_NOT_RESOLVED" in resp.json()["detail"] and "Call log" not in resp.json()["detail"]
    assert fake_ai.calls == []

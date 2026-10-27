"""Rule 1: a Passed verdict must be backed by text on the real page, otherwise runner downgrades it."""
import pytest

from app import runner, settings
from app.models import Run, TestResult

from .conftest import make_case

CART_TEXT = "AcmeCart\nYour cart\n1 item\nTotal: $19.99"
CART_ARIA = '- heading "Your cart"\n- button "Checkout"\n- button "Remove item"'
CFG = settings.Settings(screenshots=False, ask_when_unsure=False)


class FakeLocator:
    def __init__(self, page):
        self.page = page
        self.first = self

    def aria_snapshot(self):
        return self.page.aria

    def click(self, **kw):
        if self.page.click_error:
            raise RuntimeError(self.page.click_error + "\nmore detail")


class FakePage:
    """Just enough of a Playwright page for runner._run_case."""

    def __init__(self, text=CART_TEXT, aria=CART_ARIA, goto_error=None, click_error=None):
        self.text, self.aria, self.goto_error, self.click_error = text, aria, goto_error, click_error
        self.url = "about:blank"

    def on(self, event, handler):
        pass

    def goto(self, url, **kw):
        if self.goto_error:
            raise RuntimeError(self.goto_error)
        self.url = url

    def wait_for_load_state(self, *a, **kw):
        pass

    def wait_for_timeout(self, ms):
        pass

    def locator(self, selector):
        return FakeLocator(self)

    def get_by_role(self, role, name):
        return FakeLocator(self)

    def inner_text(self, selector):
        return self.text

    def screenshot(self, path):
        pass


class FakeBrowser:
    def __init__(self, page):
        self.page = page

    def new_context(self, viewport):
        page = self.page

        class Ctx:
            def new_page(self):
                return page

            def close(self):
                pass

        return Ctx()


def run_case(fake_ai, *replies, page=None) -> TestResult:
    fake_ai.replies = list(replies)
    run = Run(id=1, url="http://shop.test/", viewport="Desktop", status="Running",
              created_at="2026-10-27T10:00:00", results=[TestResult(case=make_case())])
    result = run.results[0]
    runner._run_case(FakeBrowser(page or FakePage()), run, result, out=None, cfg=CFG)
    return result


def finish(status, evidence=None, reason="seen on page"):
    args = {"status": status, "reason": reason}
    if evidence is not None:
        args["evidence"] = evidence
    return "finish", args


# ---------- Passed stays Passed only with real evidence ----------

def test_passed_with_evidence_on_page_stays_passed(fake_ai):
    result = run_case(fake_ai, finish("Passed", ["1 item", "Total: $19.99"]))
    assert result.status == "Passed"
    assert result.reason == "seen on page"


def test_passed_with_evidence_missing_is_blocked(fake_ai):
    result = run_case(fake_ai, finish("Passed", ["Order confirmed"]))
    assert result.status == "Blocked"
    assert result.reason.startswith("Needs review")
    assert "Order confirmed" in result.reason


def test_passed_with_one_of_several_snippets_missing_is_blocked(fake_ai):
    result = run_case(fake_ai, finish("Passed", ["1 item", "2 items"]))
    assert result.status == "Blocked"
    assert "2 items" in result.reason and "'1 item'" not in result.reason


def test_evidence_match_ignores_case_and_whitespace(fake_ai):
    result = run_case(fake_ai, finish("Passed", ["  your   CART ", "total:\n$19.99"]))
    assert result.status == "Passed"


def test_evidence_found_only_in_accessible_name_counts(fake_ai):
    # icon-only button: in the aria snapshot, not in the visible text
    result = run_case(fake_ai, finish("Passed", ["Remove item"]))
    assert result.status == "Passed"


def test_evidence_on_previous_page_does_not_count(fake_ai):
    page = FakePage(text="Login\nWrong password", aria='- heading "Login"')
    result = run_case(fake_ai, finish("Passed", ["Your cart"]), page=page)
    assert result.status == "Blocked"


def test_paraphrased_evidence_is_blocked(fake_ai):
    result = run_case(fake_ai, finish("Passed", ["one item in the cart"]))
    assert result.status == "Blocked"


@pytest.mark.parametrize("evidence", [None, [], [""], ["   ", "\n"]])
def test_passed_without_any_evidence_is_blocked(fake_ai, evidence):
    result = run_case(fake_ai, finish("Passed", evidence))
    assert result.status == "Blocked"
    assert "quoted no evidence" in result.reason


def test_blank_snippet_next_to_missing_one_is_still_blocked(fake_ai):
    result = run_case(fake_ai, finish("Passed", ["", "Order confirmed"]))
    assert result.status == "Blocked"
    assert "Order confirmed" in result.reason


# ---------- Other verdicts are not touched by the check ----------

@pytest.mark.parametrize("status", ["Failed", "Blocked"])
def test_non_passed_verdicts_are_kept_even_without_evidence(fake_ai, status):
    result = run_case(fake_ai, finish(status, ["Order confirmed"], reason="no confirmation"))
    assert result.status == status
    assert result.reason == "no confirmation"


# ---------- Loop edge cases ----------

def test_no_verdict_after_max_actions_is_blocked(fake_ai):
    replies = [("press", {"key": "Tab"})] * runner.MAX_ACTIONS
    result = run_case(fake_ai, *replies)
    assert result.status == "Blocked"
    assert str(runner.MAX_ACTIONS) in result.reason
    assert len(fake_ai.calls) == runner.MAX_ACTIONS


def test_failed_action_is_logged_and_agent_continues(fake_ai):
    page = FakePage(click_error="element not found")
    result = run_case(fake_ai, ("click", {"role": "button", "name": "Buy"}), finish("Failed", ["1 item"]), page=page)
    assert result.status == "Failed"
    assert any(line.startswith("ERROR click") and "element not found" in line for line in result.log)
    assert "more detail" not in " ".join(result.log)  # only the first line of the error
    assert "ERROR click" in fake_ai.calls[1]["prompt"]  # the AI sees its own failed action


def test_site_that_does_not_open_is_blocked(fake_ai):
    result = run_case(fake_ai, page=FakePage(goto_error="net::ERR_CONNECTION_REFUSED"))
    assert result.status == "Blocked"
    assert "ERR_CONNECTION_REFUSED" in result.reason
    assert fake_ai.calls == []

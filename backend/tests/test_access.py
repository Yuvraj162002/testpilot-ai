"""Public mode: access codes, each code sees only its own runs, no private URLs, no Android."""
import pytest

from app import access, ai, db, runner, settings

from .conftest import make_case, make_run

KEY = {"X-Anthropic-Key": "sk-ant-test-123"}
REAL_RUN_TESTS = runner.run_tests
ADMIN = {"X-Admin-Password": "admin-pass"}
PUBLIC_URL = "https://example.com/"


@pytest.fixture
def api():
    """https, like the real deploy: the access cookie is Secure."""
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app, base_url="https://testserver")


@pytest.fixture
def public(monkeypatch):
    monkeypatch.setattr(access, "PUBLIC", True)
    monkeypatch.setattr(access, "ADMIN_PASSWORD", "admin-pass")
    monkeypatch.setattr(access, "FAIL_DELAY_S", 0)
    monkeypatch.setattr(ai, "REQUIRE_USER_KEY", True)
    monkeypatch.setattr(access, "_lookup", fake_lookup)
    monkeypatch.setattr(runner, "run_tests", lambda run_id, key=None: None)


def fake_lookup(host, port):
    """public.test / example.com are 'public' but live on this machine, so the proxy can be tested locally."""
    return (None, "127.0.0.1") if host in ("example.com", "public.test") else ("private", None)


def sign_in(api, code):
    api.cookies.clear()
    assert api.post("/api/login", json={"code": code}).status_code == 200


def start_run(api, url=PUBLIC_URL):
    return api.post("/api/runs", headers=KEY, json={"url": url, "cases": [make_case().model_dump()]})


# ---------- codes ----------

def test_api_needs_a_code(api, public):
    assert api.get("/api/runs").status_code == 403
    assert api.get("/api/health").status_code == 200  # the app can still load and show the code screen


def test_wrong_code_is_rejected(api, public):
    assert api.post("/api/login", json={"code": "tp-guess"}).status_code == 403
    api.cookies.set(access.COOKIE, "tp-guess")
    assert api.get("/api/runs").status_code == 403


def test_admin_creates_and_revokes_codes(api, public):
    assert api.post("/api/admin/codes", json={"label": "Judge 1"}).status_code == 403
    assert api.post("/api/admin/codes", json={"label": "Judge 1"}, headers={"X-Admin-Password": "nope"}).status_code == 403
    code = api.post("/api/admin/codes", json={"label": "Judge 1"}, headers=ADMIN).json()["code"]
    sign_in(api, code)
    assert api.get("/api/me").json() == {"label": "Judge 1"}
    assert api.get("/api/runs").status_code == 200
    api.post("/api/admin/codes/revoke", json={"code": code}, headers=ADMIN)
    assert api.get("/api/runs").status_code == 403


def test_admin_is_off_without_a_password(api, public, monkeypatch):
    monkeypatch.setattr(access, "ADMIN_PASSWORD", "")
    assert api.get("/api/admin/codes", headers={"X-Admin-Password": ""}).status_code == 403


# ---------- each code sees only its own runs ----------

def test_runs_and_screenshots_are_private_to_their_code(api, public, tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "EVIDENCE_DIR", tmp_path)  # never touch the real runs/ folder
    a, b = access.new_code("A")["code"], access.new_code("B")["code"]
    sign_in(api, a)
    run_id = start_run(api).json()["id"]
    (tmp_path / str(run_id)).mkdir()
    (tmp_path / str(run_id) / "case_1.png").write_bytes(b"png")
    assert api.get(f"/evidence/{run_id}/case_1.png").status_code == 200
    assert db.get(run_id).owner == access.owner_of(a) and a not in db.get(run_id).model_dump_json()

    sign_in(api, b)
    assert api.get("/api/runs").json() == []
    assert api.get(f"/api/runs/{run_id}").status_code == 404
    assert api.get(f"/evidence/{run_id}/case_1.png").status_code == 404
    assert api.post(f"/api/runs/{run_id}/cases/1/answer", json={"answer": "x"}).status_code == 404
    assert api.post(f"/api/runs/{run_id}/cases/1/bug", headers=KEY).status_code == 404


def test_evidence_paths_cannot_climb_into_another_run(api, public, tmp_path, monkeypatch):
    monkeypatch.setattr(runner, "EVIDENCE_DIR", tmp_path)
    sign_in(api, access.new_code("A")["code"])
    victim = start_run(api).json()["id"]
    (tmp_path / str(victim)).mkdir()
    (tmp_path / str(victim) / "case_1.png").write_bytes(b"png")
    db.stop_unfinished(victim, "done")
    sign_in(api, access.new_code("B")["code"])
    mine = start_run(api).json()["id"]
    (tmp_path / str(mine)).mkdir()
    for path in [f"/evidence/{mine}/%2e%2e/{victim}/case_1.png", f"/evidence/{mine}/..%2f{victim}/case_1.png",
                 f"/evidence/{mine}/../{victim}/case_1.png", f"/evidence/{mine}/%2e%2e%2f{victim}%2fcase_1.png"]:
        assert api.get(path).status_code in (403, 404), path
    assert api.get("/evidence/99999999999999999999999/case_1.png").status_code == 404


def test_local_runs_are_not_visible_in_public_mode(api, public):
    make_run("Passed")  # owner "" = made on the local machine
    sign_in(api, access.new_code("A")["code"])
    assert api.get("/api/runs").json() == []


def test_one_run_at_a_time_per_code(api, public):
    sign_in(api, access.new_code("A")["code"])
    assert start_run(api).status_code == 200
    assert start_run(api).status_code == 409


# ---------- what the server's browser may open ----------

@pytest.mark.parametrize("url", ["http://localhost:8000/", "http://169.254.169.254/latest/meta-data/",
                                 "http://my-app.internal/"])
def test_private_urls_are_rejected(api, public, url):
    sign_in(api, access.new_code("A")["code"])
    res = start_run(api, url)
    assert res.status_code == 400 and "private" in res.json()["detail"]


def test_android_is_off(api, public):
    sign_in(api, access.new_code("A")["code"])
    res = api.post("/api/runs", headers=KEY, json={"platform": "android", "url": "/srv/app.apk",
                                                   "cases": [make_case().model_dump()]})
    assert res.status_code == 400
    assert api.get("/api/android/devices").json() == {"devices": []}


def test_api_docs_are_hidden_in_public_mode():
    import subprocess
    import sys

    code = "from app.main import app; print(app.docs_url, app.openapi_url)"
    out = subprocess.run([sys.executable, "-c", code], env={"PUBLIC_MODE": "1", "PATH": ""}, capture_output=True, text=True)
    assert out.stdout.strip() == "None None", out.stderr


def test_settings_are_read_only(api, public):
    sign_in(api, access.new_code("A")["code"])
    assert api.put("/api/settings", json=settings.Settings().model_dump()).status_code == 403


@pytest.mark.parametrize("ip, ok", [("93.184.216.34", True), ("127.0.0.1", False), ("10.0.0.5", False),
                                    ("169.254.169.254", False), ("fdaa:0:1::3", False), ("::1", False),
                                    ("::ffff:127.0.0.1", False), ("2606:4700::1111", True)])
def test_address_check(monkeypatch, ip, ok):
    monkeypatch.setattr(access, "PUBLIC", True)
    monkeypatch.setattr(access.socket, "getaddrinfo", lambda *a, **kw: [(None, None, None, "", (ip, 80))])
    assert (access.blocked(f"http://site-{ip.replace(':', '-')}.test/") is None) is ok


def test_local_mode_allows_everything():
    assert access.blocked("http://localhost:8000/demo/") is None


def test_bad_port_is_refused_not_a_crash(monkeypatch):
    monkeypatch.setattr(access, "PUBLIC", True)
    assert access.blocked("https://example.com:99999/") == "the port is not valid"


# ---------- egress proxy: every browser connection is checked, then dialled by IP ----------

@pytest.fixture
def site():
    """A local HTTP server: /redir sends the browser on to a private host."""
    import http.server
    import threading

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            if self.path == "/redir":
                self.send_response(302)
                self.send_header("Location", f"http://private.test:{self.server.server_address[1]}/secret")
                self.end_headers()
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"PAGE " + self.path.encode())

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()


def through_proxy(request: bytes) -> bytes:
    import socket

    port = int(access.launch_options()["proxy"]["server"].rsplit(":", 1)[1])
    with socket.create_connection(("127.0.0.1", port), timeout=5) as s:
        s.sendall(request)
        out = b""
        while chunk := s.recv(65536):
            out += chunk
    return out


def test_proxy_passes_public_hosts(public, site):
    out = through_proxy(f"GET http://public.test:{site}/hello HTTP/1.1\r\nHost: public.test\r\n\r\n".encode())
    assert out.startswith(b"HTTP/1.0 200") and out.endswith(b"PAGE /hello")


@pytest.mark.parametrize("request_line", ["GET http://private.test:{p}/secret HTTP/1.1", "CONNECT private.test:{p} HTTP/1.1",
                                          "GET ftp://public.test:{p}/ HTTP/1.1", "CONNECT public.test:99999 HTTP/1.1"])
def test_proxy_refuses_private_hosts(public, site, request_line):
    out = through_proxy((request_line.format(p=site) + "\r\n\r\n").encode())
    assert out.startswith(b"HTTP/1.1 403")


def test_proxy_redirect_target_is_checked_too(public, site):
    """The redirect reaches the browser; its next request (to the private host) is refused."""
    out = through_proxy(f"GET http://public.test:{site}/redir HTTP/1.1\r\n\r\n".encode())
    assert b"302" in out.split(b"\r\n")[0]
    out = through_proxy(f"GET http://private.test:{site}/secret HTTP/1.1\r\n\r\n".encode())
    assert out.startswith(b"HTTP/1.1 403")


def test_proxy_dials_the_checked_ip_not_a_fresh_lookup(public, site, monkeypatch):
    """DNS rebinding: whatever the name resolves to later, the connection goes to the IP that was checked."""
    dialled = []
    real = access.socket.create_connection
    monkeypatch.setattr(access.socket, "create_connection", lambda addr, **kw: dialled.append(addr) or real(addr, **kw))
    through_proxy(f"GET http://public.test:{site}/ HTTP/1.1\r\n\r\n".encode())
    assert [a for a in dialled if a[1] == site] == [("127.0.0.1", site)]  # (the other one is us -> proxy)


def test_local_mode_uses_no_proxy():
    assert access.launch_options() == {}


# ---------- a run that dies never locks its code out ----------

def test_crashed_run_is_closed_and_code_can_run_again(api, public, monkeypatch):
    def crash(run_id):
        raise RuntimeError("browser died")

    sign_in(api, access.new_code("A")["code"])
    run_id = start_run(api).json()["id"]  # run_tests is stubbed: the run stays Running
    assert start_run(api).status_code == 409
    monkeypatch.setattr(runner, "_run_all", crash)
    with pytest.raises(RuntimeError):
        REAL_RUN_TESTS(run_id)
    run = db.get(run_id)
    assert run.status == "Needs review" and run.results[0].status == "Blocked"
    assert start_run(api).status_code == 200


def test_runs_left_running_by_a_restart_are_closed():
    run = make_run("Passed", "Running", "Queued", run_status="Running")
    db.stop_unfinished(run.id, "The server restarted during this run.")
    run = db.get(run.id)
    assert run.status == "Needs review"
    assert [r.status for r in run.results] == ["Passed", "Blocked", "Blocked"]


# ---------- codes from the ACCESS_CODES secret (hosts without a persistent disk) ----------

def test_env_codes_are_parsed():
    assert access._env_codes("Judge 1:tp-abc123def, Judge 2 : tp-xyz789uvw ,broken,Short:tp-1") == {
        "tp-abc123def": "Judge 1", "tp-xyz789uvw": "Judge 2"}


def test_env_code_signs_in_and_cannot_be_revoked(api, public, monkeypatch):
    monkeypatch.setattr(access, "ENV_CODES", {"tp-judge0001": "Judge 1"})
    sign_in(api, "tp-judge0001")
    assert api.get("/api/me").json() == {"label": "Judge 1"}
    listed = api.get("/api/admin/codes", headers=ADMIN).json()
    assert listed[0]["code"] == "tp-judge0001" and listed[0]["fixed"] is True
    assert api.post("/api/admin/codes/revoke", json={"code": "tp-judge0001"}, headers=ADMIN).status_code == 400
    assert api.get("/api/runs").status_code == 200

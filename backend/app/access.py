"""Public deploy (PUBLIC_MODE=1): access codes, each code sees only its own runs, and an egress proxy so the
server's browser can never reach private networks (localhost, the cloud's internal network, metadata IPs)."""
import hashlib
import hmac
import ipaddress
import os
import secrets
import socket
import socketserver
import threading
from datetime import datetime
from urllib.parse import urlsplit

from . import db

PUBLIC = os.getenv("PUBLIC_MODE") == "1"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
COOKIE = "tp_access"
FAIL_DELAY_S = 1  # slows down guessing codes / the admin password


def _env_codes(raw: str) -> dict[str, str]:
    """ACCESS_CODES="Judge 1:tp-abc123,Judge 2:tp-def456" -> {code: label}. Short codes are ignored."""
    pairs = (item.rsplit(":", 1) for item in raw.split(",") if ":" in item)
    return {code.strip(): name.strip() or "Tester" for name, code in pairs if len(code.strip()) >= 10}


# Codes from a secret survive restarts on hosts without a persistent disk (Hugging Face Spaces).
ENV_CODES = _env_codes(os.getenv("ACCESS_CODES", ""))


def _conn():
    conn = db._conn()
    conn.execute("CREATE TABLE IF NOT EXISTS access_codes (code TEXT PRIMARY KEY, label TEXT NOT NULL, created_at TEXT NOT NULL)")
    return conn


def owner_of(code: str) -> str:
    """What a run stores as its owner: a hash, so the code itself never sits in run data."""
    return hashlib.sha256(code.encode()).hexdigest()[:16]


def new_code(label: str) -> dict:
    code = "tp-" + secrets.token_hex(6)
    row = {"code": code, "label": label.strip()[:60] or "Tester", "created_at": datetime.now().isoformat(timespec="seconds")}
    with _conn() as conn:
        conn.execute("INSERT INTO access_codes VALUES (:code, :label, :created_at)", row)
    return row


def codes() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute("SELECT code, label, created_at FROM access_codes ORDER BY created_at DESC").fetchall()
    fixed = [{"code": c, "label": lbl, "created_at": "", "fixed": True} for c, lbl in ENV_CODES.items()]
    return fixed + [{"code": c, "label": lbl, "created_at": t, "fixed": False} for c, lbl, t in rows]


def revoke(code: str) -> None:
    if code in ENV_CODES:
        raise ValueError("This code comes from the ACCESS_CODES secret: remove it there and restart")
    with _conn() as conn:
        conn.execute("DELETE FROM access_codes WHERE code = ?", (code,))


def label(code: str | None) -> str | None:
    """The code's label if the code is valid, else None."""
    if not code:
        return None
    if code in ENV_CODES:
        return ENV_CODES[code]
    with _conn() as conn:
        row = conn.execute("SELECT label FROM access_codes WHERE code = ?", (code,)).fetchone()
    return row[0] if row else None


def is_admin(password: str | None) -> bool:
    return bool(ADMIN_PASSWORD) and hmac.compare_digest((password or "").encode(), ADMIN_PASSWORD.encode())


def _lookup(host: str, port: int) -> tuple[str | None, str | None]:
    """(why the host is not allowed, or None; the checked IP to connect to)."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        return f"{host} could not be found", None
    ips = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip.version == 6 and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if not ip.is_global:
            return f"{host} is a private or local address", None
        ips.append(str(ip))
    return None, ips[0]


def blocked(url: str) -> str | None:
    """Why the server's browser must not open `url` in public mode, or None if it may."""
    if not PUBLIC:
        return None
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return "Only http:// and https:// sites can be tested"
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError:
        return "the port is not valid"
    return _lookup(parts.hostname, port)[0]


# ---------- egress proxy: the only way the public-mode browser reaches the network ----------
# Every connection Chromium makes (pages, redirects, fetch, WebSockets, service workers) arrives here as a
# CONNECT or an absolute-URL request. The host is resolved once, checked, and that exact IP is dialled, so
# redirects and DNS rebinding can't reach a private address.

class _Proxy(socketserver.ThreadingTCPServer):
    daemon_threads = True


class _ProxyHandler(socketserver.StreamRequestHandler):
    timeout = 60

    def handle(self):
        try:
            method, target, version = self.rfile.readline(8192).decode("latin-1").split()
        except ValueError:
            return
        headers = []
        while (line := self.rfile.readline(8192)) not in (b"\r\n", b"\n", b""):
            headers.append(line)
        try:
            if method == "CONNECT":
                host, _, port = target.rpartition(":")
                host, port = host.strip("[]"), int(port)
            else:
                url = urlsplit(target)
                if url.scheme != "http" or not url.hostname:
                    return self._deny()
                host, port = url.hostname, url.port or 80
        except ValueError:
            return self._deny()
        if not 0 < port < 65536:
            return self._deny()
        why, ip = _lookup(host, port)
        if why:
            return self._deny()
        try:
            upstream = socket.create_connection((ip, port), timeout=30)
        except OSError:
            return self.wfile.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
        if method == "CONNECT":
            self.wfile.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        else:
            # One request per connection (Connection: close), so a reused connection can't switch hosts.
            path = (url.path or "/") + (f"?{url.query}" if url.query else "")
            upgrade = any(h.lower().startswith(b"upgrade:") for h in headers)
            keep = [h for h in headers if not h.lower().startswith((b"proxy-", b"connection:", b"keep-alive:"))]
            upstream.sendall(f"{method} {path} {version}\r\n".encode("latin-1") + b"".join(keep)
                             + (b"Connection: Upgrade\r\n" if upgrade else b"Connection: close\r\n") + b"\r\n")
        self._pipe(upstream)

    def _deny(self):
        self.wfile.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")

    def _pipe(self, upstream: socket.socket) -> None:
        def client_to_upstream():
            try:
                while data := self.rfile.read1(65536):  # read1: first whatever is already buffered
                    upstream.sendall(data)
            except OSError:
                pass
            finally:
                try:
                    upstream.shutdown(socket.SHUT_WR)
                except OSError:
                    pass

        threading.Thread(target=client_to_upstream, daemon=True).start()
        try:
            while data := upstream.recv(65536):
                self.connection.sendall(data)
        except OSError:
            pass
        finally:
            upstream.close()
            try:  # also wakes the reader thread, which holds rfile's lock until its read returns
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


_proxy_port: int | None = None
_proxy_lock = threading.Lock()


def launch_options() -> dict:
    """Playwright launch options. Public mode: all browser traffic goes through the checking proxy
    (Playwright also sends loopback through it), and WebRTC may not send UDP around it."""
    global _proxy_port
    if not PUBLIC:
        return {}
    with _proxy_lock:
        if _proxy_port is None:
            server = _Proxy(("127.0.0.1", 0), _ProxyHandler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            _proxy_port = server.server_address[1]
    return {"proxy": {"server": f"http://127.0.0.1:{_proxy_port}"},
            "args": ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"]}

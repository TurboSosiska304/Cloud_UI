"""Cloud_UI backend: static SPA + REST API + job queue for sd-cli."""
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import mimetypes
import os
import re
import shutil
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

from executor import (Executor, MODELS, UPSCALERS, TEXT_ENCODERS, VAES,
                      DEFAULT_SETTINGS, OUT, WORKFLOWS, ROOT)

HOST = os.environ.get("CLOUD_UI_HOST", "127.0.0.1")
PORT = int(os.environ.get("CLOUD_UI_PORT", "8188"))
DIST = ROOT / "frontend" / "dist"
UPLOADS = ROOT / "uploads"
UPLOADS.mkdir(exist_ok=True)

executor = Executor()


def json_bytes(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "CloudUI/0.1"

    def log_message(self, fmt, *args):  # quieter log
        if "/api/jobs" in self.path and "GET" in fmt:
            return
        print("[http]", self.address_string(), fmt % args)

    # ---------- helpers ----------
    def send_json(self, obj, code=200):
        data = json_bytes(obj)
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, path: Path, cache=True):
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if cache:
            self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError as e:
            raise ValueError(f"bad json: {e}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ---------- routing ----------
    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        q = parse_qs(u.query)
        try:
            if p == "/api/health":
                return self.send_json({"ok": True, "time": time.time()})
            if p == "/api/config":
                return self.send_json({
                    "models": {k: {"label": v["label"], "steps": v["steps"],
                                   "cfg": v["cfg"], "family": v["family"],
                                   "default_te": v.get("default_te"),
                                   "default_vae": v.get("default_vae")}
                               for k, v in MODELS.items()},
                    "text_encoders": {k: v[0] for k, v in TEXT_ENCODERS.items()},
                    "vaes": {k: v[0] for k, v in VAES.items()},
                    "upscalers": list(UPSCALERS),
                    "defaults": DEFAULT_SETTINGS,
                })
            if p == "/api/jobs":
                jobs = sorted(executor.jobs.values(), key=lambda j: j.created, reverse=True)
                return self.send_json([j.public() for j in jobs[:100]])
            m = re.fullmatch(r"/api/jobs/([a-f0-9]+)/log", p)
            if m:
                job = executor.jobs.get(m.group(1))
                if not job:
                    return self.send_json({"error": "job not found"}, 404)
                since = int((q.get("since") or ["0"])[0])
                since = max(0, min(since, len(job.log)))
                lines = job.log[since:since + 2000]
                return self.send_json({"lines": lines, "next": since + len(lines),
                                       "total": len(job.log)})
            m = re.fullmatch(r"/api/jobs/([a-f0-9]+)", p)
            if m:
                job = executor.jobs.get(m.group(1))
                if not job:
                    return self.send_json({"error": "job not found"}, 404)
                return self.send_json(job.public())
            if p == "/api/workflows":
                items = []
                for f in sorted(WORKFLOWS.glob("*.json")):
                    items.append({"name": f.stem, "mtime": f.stat().st_mtime})
                return self.send_json(items)
            m = re.fullmatch(r"/api/workflows/([^/]+)", p)
            if m:
                f = WORKFLOWS / (unquote(m.group(1)) + ".json")
                if not f.exists():
                    return self.send_json({"error": "not found"}, 404)
                return self.send_json(json.loads(f.read_text()))
            if p == "/api/outputs":
                items = []
                for f in OUT.rglob("*"):
                    if f.is_file():
                        st = f.stat()
                        items.append({"path": str(f.relative_to(OUT)),
                                      "size": st.st_size, "mtime": st.st_mtime})
                items.sort(key=lambda x: x["mtime"], reverse=True)
                return self.send_json(items[:200])
            if p == "/api/image":
                raw = unquote(q.get("path", [""])[0])
                cand = Path(raw)
                if not cand.is_absolute():
                    cand = OUT / raw
                allowed = str(cand.resolve()).startswith(("/home/nik/", str(OUT)))
                if allowed and cand.exists() and cand.is_file():
                    return self.send_file(cand, cache=False)
                return self.send_error(404)
            if p.startswith("/files/"):
                rel = unquote(p[len("/files/"):])
                cand = (OUT / rel).resolve()
                if str(cand).startswith(str(OUT.resolve())):
                    return self.send_file(cand)
                return self.send_error(403)
            # static SPA
            return self.serve_static(p)
        except Exception as e:  # noqa: BLE001
            return self.send_json({"error": str(e)}, 500)

    def do_POST(self):
        u = urlparse(self.path)
        p = u.path
        try:
            body = self.read_json()
            if p == "/api/jobs":
                graph = body.get("graph") or {}
                name = body.get("name") or ""
                if not graph.get("nodes"):
                    return self.send_json({"error": "empty graph"}, 400)
                job = executor.submit(graph, name)
                return self.send_json(job.public())
            m = re.fullmatch(r"/api/jobs/([a-f0-9]+)/cancel", p)
            if m:
                ok = executor.cancel(m.group(1))
                return self.send_json({"ok": ok})
            m = re.fullmatch(r"/api/workflows/([^/]+)", p)
            if m:
                name = re.sub(r"[^A-Za-z0-9_. -]", "_", unquote(m.group(1)))[:80]
                (WORKFLOWS / (name + ".json")).write_text(
                    json.dumps(body, ensure_ascii=False, indent=2))
                return self.send_json({"ok": True, "name": name})
            if p == "/api/upload":
                name = re.sub(r"[^A-Za-z0-9_.-]", "_", body.get("name") or "upload.png")
                data = base64.b64decode(body.get("data") or "")
                ts = int(time.time() * 1000)
                tmp = UPLOADS / f"{ts}_{name}"
                tmp.write_bytes(data)
                dst = tmp
                # normalize to PNG: sd.cpp identifies images by extension and
                # does not read WebP renamed to .jpeg
                if shutil.which("magick"):
                    png = UPLOADS / f"{ts}_{Path(name).stem}.png"
                    r = subprocess.run(["magick", str(tmp), "-strip", str(png)],
                                       capture_output=True)
                    if r.returncode == 0 and png.exists():
                        tmp.unlink(missing_ok=True)
                        dst = png
                return self.send_json({"path": str(dst)})
            return self.send_json({"error": "not found"}, 404)
        except Exception as e:  # noqa: BLE001
            return self.send_json({"error": str(e)}, 500)

    def serve_static(self, p: str):
        if not DIST.exists():
            html = b"""<!doctype html><meta charset=utf-8>
            <body style='font-family:system-ui;background:#111;color:#eee;padding:40px'>
            <h1>Cloud_UI</h1><p>Frontend not built yet.</p>
            <pre>cd frontend && npm install && npm run build</pre></body>"""
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return
        rel = p.lstrip("/")
        cand = (DIST / rel).resolve()
        if not str(cand).startswith(str(DIST.resolve())) or not cand.exists() or cand.is_dir():
            cand = DIST / "index.html"
        return self.send_file(cand, cache=not cand.name.endswith("index.html"))


def main():
    print(f"Cloud_UI on http://{HOST}:{PORT}  (models: {len(MODELS)}, outputs: {OUT})")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

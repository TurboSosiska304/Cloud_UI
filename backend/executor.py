"""Graph executor for Cloud_UI: turns a node graph into sd-cli invocations."""
from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SD = ROOT.parent / "sd.cpp"
BIN = SD / "build" / "bin" / "sd-cli"
M = Path("/home/nik/drives/SSD/ml-models")
OUT = ROOT / "outputs"
WORKFLOWS = ROOT / "workflows"
JOBS = ROOT / "jobs"
for d in (OUT, WORKFLOWS, JOBS):
    d.mkdir(parents=True, exist_ok=True)

TEXT_ENCODERS = {
    "qwen3-4b": ("Qwen3-4B (FLUX.2, Z-Image)", str(M / "text_encoders/qwen3/Qwen3-4B-Q4_K_M.gguf")),
    "qwen3-8b": ("Qwen3-8B (FLUX.2 9B)", str(M / "text_encoders/qwen3/Qwen3-8B-Q4_K_S.gguf")),
    "qwen3-vl-4b": ("Qwen3-VL-4B (FLUX.3)", str(M / "text_encoders/qwen3/Qwen3-VL-4B-Instruct-GGUF/Qwen3-VL-4B-Instruct-Q4_K_M.gguf")),
    "qwen3-0.6b": ("Qwen3-0.6B (Anima)", str(M / "text_encoders/qwen3/qwen_3_06b_base.safetensors")),
    "umt5-xxl": ("UMT5-XXL (Wan)", str(M / "text_encoders/t5/umt5-xxl-encoder-Q4_K_M.gguf")),
    "t5xxl-fp8": ("T5-XXL fp8", str(M / "text_encoders/t5/t5xxl_fp8_e4m3fn.safetensors")),
    "clip-l": ("CLIP-L", str(M / "text_encoders/clip/clip_l.safetensors")),
}

VAES = {
    "flux2": ("FLUX.2 VAE (FLUX.2/FLUX.3)", str(M / "vae/flux2-vae.safetensors")),
    "flux1-ae": ("FLUX.1 AE (Z-Image)", str(M / "vae/ae.safetensors")),
    "qwen-image": ("Qwen-Image VAE (Anima)", str(M / "vae/qwen_image_vae.safetensors")),
    "wan22": ("Wan 2.2 VAE", str(M / "vae/Wan2.2_VAE.safetensors")),
    "sd15": ("SD1.5 VAE", str(M / "vae/vae-ft-mse-840000-ema-pruned.safetensors")),
    "pixart": ("PixArt VAE", str(M / "vae/pixart_sigma_vae_fp16.safetensors")),
    "hunyuan-video": ("Hunyuan Video VAE", str(M / "vae/hunyuan_video_vae_bf16.safetensors")),
}

MODELS = {
    "flux2-4b": {
        "label": "FLUX.2 klein 4B (fast)",
        "diffusion": str(M / "diffusion_models/flux2/flux-2-klein-4b-Q4_K_M.gguf"),
        "default_te": "qwen3-4b", "default_vae": "flux2",
        "steps": 4, "cfg": 1.0, "family": "flux2",
    },
    "flux2-9b": {
        "label": "FLUX.2 klein 9B (quality)",
        "diffusion": str(M / "diffusion_models/flux2/flux-2-klein-9b-Q4_K_S.gguf"),
        "default_te": "qwen3-8b", "default_vae": "flux2",
        "steps": 4, "cfg": 1.0, "family": "flux2",
    },
    "flux3": {
        "label": "FLUX.3 Image Klein (detailed)",
        "diffusion": str(M / "diffusion_models/flux3/flux-3-image-klein-UD-Q4_K_XL.gguf"),
        "default_te": "qwen3-vl-4b", "default_vae": "flux2",
        "steps": 16, "cfg": 1.0, "family": "flux3",
    },
    "zimage": {
        "label": "Z-Image-Turbo (+LoRA)",
        "diffusion": str(M / "diffusion_models/z-image/z-image-turbo-Q6_K.gguf"),
        "default_te": "qwen3-4b", "default_vae": "flux1-ae",
        "steps": 8, "cfg": 1.0, "family": "zimage",
    },
    "anima": {
        "label": "Anima (anime base)",
        "diffusion": str(M / "diffusion_models/anima/anima-preview-Q6_K.gguf"),
        "default_te": "qwen3-0.6b", "default_vae": "qwen-image",
        "steps": 16, "cfg": 6.0, "family": "anima",
    },
    "wan": {
        "label": "Wan 2.2 TI2V 5B (video)",
        "diffusion": str(M / "diffusion_models/wan/Wan2.2-TI2V-5B-Q5_K_M.gguf"),
        "default_te": "umt5-xxl", "default_vae": "wan22",
        "steps": 20, "cfg": 6.0, "family": "wan",
    },
}

UPSCALERS = {
    "RealESRGAN_x4plus": str(M / "upscale_models/RealESRGAN_x4plus.safetensors"),
    "4x-UltraSharp": str(M / "upscale_models/4x-UltraSharp.safetensors"),
}

DEFAULT_SETTINGS = {
    "auto_fit": True,
    "modules": {
        "diffusion": {"compute": "auto", "params": "auto"},
        "te": {"compute": "auto", "params": "auto"},
        "vae": {"compute": "auto", "params": "auto"},
    },
}


def _topo(nodes: dict, edges: list) -> list:
    indeg = {nid: 0 for nid in nodes}
    adj = {nid: [] for nid in nodes}
    for e in edges:
        s, t = e.get("source"), e.get("target")
        if s in nodes and t in nodes:
            adj[s].append(t)
            indeg[t] += 1
    q = [nid for nid, d in indeg.items() if d == 0]
    order = []
    while q:
        nid = q.pop(0)
        order.append(nid)
        for nxt in adj[nid]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                q.append(nxt)
    if len(order) != len(nodes):
        raise ValueError("graph has a cycle")
    return order


def _incoming(edges: list) -> dict:
    inc = {}
    for e in edges:
        inc.setdefault(e["target"], {})[e.get("targetHandle") or "in"] = e["source"]
    return inc


def backend_args(settings: dict) -> list:
    """Map UI placement settings to --backend / --params-backend."""
    s = settings or {}
    if s.get("auto_fit", True):
        return []
    mods = s.get("modules") or {}
    comp, params = [], []
    for mod in ("te", "diffusion", "vae"):
        m = mods.get(mod) or {}
        c = (m.get("compute") or "auto").lower()
        p = (m.get("params") or "auto").lower()
        if c in ("vulkan0", "cpu"):
            comp.append(f"{mod}={c}")
        if p in ("vulkan0", "cpu", "disk"):
            params.append(f"{mod}={p}")
    out = []
    if comp:
        out += ["--backend", ",".join(comp)]
    if params:
        out += ["--params-backend", ",".join(params)]
    return out


class Job:
    def __init__(self, graph: dict, name: str = ""):
        self.id = uuid.uuid4().hex[:12]
        self.graph = graph
        self.name = name or f"job_{self.id}"
        self.status = "queued"
        self.created = time.time()
        self.started = None
        self.finished = None
        self.progress = 0.0
        self.progress_text = ""
        self.log = []
        self.outputs = []
        self.error = ""
        self.proc = None
        self.dir = JOBS / self.id
        self.dir.mkdir(parents=True, exist_ok=True)

    def add_log(self, line: str):
        line = line.rstrip("\r\n")
        if not line:
            return
        self.log.append(line)
        if len(self.log) > 20000:
            del self.log[:5000]
        m = re.search(r"\|\s*(\d+)/(\d+)\s*-\s*([0-9.]+s/it)", line)
        if m:
            cur, total = int(m.group(1)), int(m.group(2))
            self.progress = cur / max(total, 1)
            self.progress_text = f"{cur}/{total} · {m.group(3)}"
            return
        m = re.search(r"(\d+)%\|", line)
        if m:
            self.progress = int(m.group(1)) / 100.0
        if "sampling completed" in line or "generate_image completed" in line:
            self.progress = max(self.progress, 0.95)

    def public(self):
        return {
            "id": self.id, "name": self.name, "status": self.status,
            "created": self.created, "started": self.started, "finished": self.finished,
            "progress": round(self.progress, 3), "progress_text": self.progress_text,
            "outputs": self.outputs, "error": self.error,
            "log_len": len(self.log), "log_tail": self.log[-120:],
        }


class Executor:
    def __init__(self):
        self.jobs = {}
        self.queue = []
        self.current = None
        self.lock = threading.Lock()
        self.worker = threading.Thread(target=self._loop, daemon=True)
        self.worker.start()

    def submit(self, graph: dict, name: str = "") -> Job:
        job = Job(graph, name)
        with self.lock:
            self.jobs[job.id] = job
            self.queue.append(job)
        return job

    def cancel(self, jid: str):
        job = self.jobs.get(jid)
        if not job:
            return False
        if job.status in ("queued", "running"):
            job.status = "cancelled"
            if job.proc and job.proc.poll() is None:
                try:
                    os.killpg(os.getpgid(job.proc.pid), signal.SIGTERM)
                except Exception:
                    job.proc.terminate()
            return True
        return False

    def _loop(self):
        while True:
            with self.lock:
                job = self.queue.pop(0) if self.queue else None
            if not job:
                time.sleep(0.4)
                continue
            if job.status == "cancelled":
                continue
            self.current = job
            job.status = "running"
            job.started = time.time()
            try:
                self._run(job)
                if job.status != "cancelled":
                    job.status = "done"
            except Exception as e:  # noqa: BLE001
                job.error = str(e)
                if job.status != "cancelled":
                    job.status = "error"
                job.add_log(f"[cloud-ui] ERROR: {e}")
            finally:
                job.finished = time.time()
                job.progress = 1.0 if job.status == "done" else job.progress
                self.current = None

    def _run(self, job: Job):
        graph = job.graph
        nodes = {n["id"]: n for n in graph.get("nodes", [])}
        edges = graph.get("edges", [])
        inc = _incoming(edges)
        settings = graph.get("settings") or DEFAULT_SETTINGS
        bargs = backend_args(settings)
        results = {}
        produced = []

        for nid in _topo(nodes, edges):
            if job.status == "cancelled":
                return
            node = nodes[nid]
            typ = node.get("type")
            data = node.get("data") or {}
            ins = inc.get(nid, {})

            if typ == "model":
                preset = data.get("preset") or "flux2-4b"
                if preset not in MODELS:
                    raise ValueError(f"unknown model preset {preset}")
                results[nid] = {"preset": preset}
            elif typ == "te":
                key = data.get("file") or "qwen3-4b"
                results[nid] = {"te": TEXT_ENCODERS.get(key, (key, key))[1]}
            elif typ == "vae":
                key = data.get("file") or "flux2"
                results[nid] = {"vae": VAES.get(key, (key, key))[1]}
            elif typ == "prompt":
                results[nid] = {"positive": data.get("positive", ""),
                                "negative": data.get("negative", "")}
            elif typ == "load_image":
                p = data.get("path", "")
                if not p or not Path(p).exists():
                    raise ValueError(f"image not found: {p}")
                results[nid] = {"image": p}
            elif typ in ("image_sampler", "image_ref_sampler", "wan_sampler"):
                preset = results.get(ins.get("model"), {}).get("preset", "flux2-4b")
                prompt = results.get(ins.get("prompt"), {})
                te = results.get(ins.get("te"), {}).get("te")
                vae = results.get(ins.get("vae"), {}).get("vae")
                ref = results.get(ins.get("image"), {}).get("image")
                out = self._run_sampler(job, nid, preset, typ, data, prompt, ref, te, vae, bargs)
                results[nid] = {"image": out}
                produced.append(out)
            elif typ == "upscale":
                src = results.get(ins.get("image"), {}).get("image")
                if not src:
                    raise ValueError("upscale: no input image")
                out = self._run_upscale(job, nid, data, src)
                results[nid] = {"image": out}
                produced.append(out)
            elif typ == "save":
                src = results.get(ins.get("image"), {}).get("image")
                if not src:
                    raise ValueError("save: no input image")
                results[nid] = {"image": src}
            else:
                job.add_log(f"[cloud-ui] skip unknown node type {typ}")

        if not produced:
            raise ValueError("nothing to generate: connect a Sampler node")
        for p in produced:
            job.outputs.append(os.path.relpath(p, OUT))
        job.progress = 1.0

    def _base_cmd(self, preset: str, te: str | None, vae: str | None, bargs: list) -> list:
        p = MODELS[preset]
        te_key = p.get("default_te")
        te_path = te or (TEXT_ENCODERS.get(te_key, (None, te_key))[1] if te_key else None)
        vae_path = vae or VAES.get(p.get("default_vae"), (None, p.get("default_vae")))[1]
        cmd = [str(BIN), "--diffusion-model", p["diffusion"], "--vae", str(vae_path)]
        if te_path:
            if p["family"] == "wan":
                cmd += ["--t5xxl", str(te_path)]
            else:
                cmd += ["--llm", str(te_path)]
        cmd += bargs
        if p["family"] == "zimage":
            cmd += ["--lora-model-dir", str(M / "loras/z-image")]
        return cmd

    def _run_sampler(self, job: Job, nid: str, preset: str, typ: str, data: dict,
                     prompt: dict, ref: str | None, te: str | None, vae: str | None,
                     bargs: list) -> str:
        p = MODELS[preset]
        family = "wan" if typ == "wan_sampler" else p["family"]
        steps = int(data.get("steps") or p["steps"])
        cfg = float(data.get("cfg") if data.get("cfg") is not None else p["cfg"])
        width = int(data.get("width") or 1024)
        height = int(data.get("height") or 1024)
        seed = int(data.get("seed") or 42)
        batch = int(data.get("batch") or 1)
        sampler = data.get("sampler") or "euler"
        positive = prompt.get("positive") or data.get("positive") or ""
        negative = prompt.get("negative") or ""

        outdir = OUT / job.id
        outdir.mkdir(parents=True, exist_ok=True)
        cmd = self._base_cmd(preset, te, vae, bargs)

        if family == "wan":
            frames = int(data.get("frames") or 33)
            fps = int(data.get("fps") or 16)
            flow = float(data.get("flow_shift") or 3.0)
            cmd += ["-M", "vid_gen", "-W", str(width), "-H", str(height),
                    "--video-frames", str(frames), "--fps", str(fps),
                    "--flow-shift", str(flow)]
            out = outdir / f"{nid}.webm"
        else:
            cmd += ["-W", str(width), "-H", str(height)]
            out = outdir / f"{nid}.png"

        cmd += ["--cfg-scale", str(cfg), "--sampling-method", sampler,
                "--steps", str(steps), "--seed", str(seed), "-o", str(out)]
        if batch > 1 and family != "wan":
            cmd += ["-b", str(batch)]
        if positive:
            cmd += ["-p", positive]
        if negative:
            cmd += ["-n", negative]
        if ref:
            if typ == "image_ref_sampler" and family in ("flux2", "flux3"):
                cmd += ["-r", ref]
            else:
                cmd += ["-i", ref, "--strength", str(float(data.get("strength") or 0.6))]
        if width * height > 1_150_000 and family != "wan":
            cmd += ["--vae-tiling", "--vae-tile-size", "512x512"]
        if family == "wan":
            cmd += ["--vae-tiling"]

        self._spawn(job, cmd)
        if family == "wan" and shutil.which("ffmpeg") and out.exists():
            mp4 = outdir / f"{nid}.mp4"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(out),
                            "-c:v", "libx264", "-pix_fmt", "yuv420p",
                            "-crf", "18", "-movflags", "+faststart", str(mp4)],
                           check=False)
            if mp4.exists():
                out.unlink(missing_ok=True)
                out = mp4
        return str(out)

    def _run_upscale(self, job: Job, nid: str, data: dict, src: str) -> str:
        name = data.get("model") or "RealESRGAN_x4plus"
        path = UPSCALERS.get(name, name)
        repeats = int(data.get("repeats") or 1)
        outdir = OUT / job.id
        outdir.mkdir(parents=True, exist_ok=True)
        out = outdir / f"{nid}.png"
        cmd = [str(BIN), "-M", "upscale", "--upscale-model", path,
               "--upscale-repeats", str(repeats), "-i", src, "-o", str(out)]
        self._spawn(job, cmd)
        return str(out)

    def _spawn(self, job: Job, cmd: list):
        job.add_log("[cloud-ui] " + " ".join(cmd))
        env = os.environ.copy()
        env.setdefault("PATH", "/usr/bin:/bin")
        job.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True,
                                    bufsize=1, env=env, start_new_session=True)
        assert job.proc.stdout is not None
        for line in job.proc.stdout:
            job.add_log(line)
            if job.status == "cancelled":
                break
        code = job.proc.wait()
        if job.status == "cancelled":
            raise RuntimeError("cancelled")
        if code != 0:
            raise RuntimeError(f"sd-cli exited with {code}")

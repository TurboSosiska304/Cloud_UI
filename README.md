# Cloud_UI

A ComfyUI-style node editor for [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp).
Everything runs locally; the backend spawns `sd-cli`.

## Run

```bash
cd /home/nik/Projects/opencode/sd_cpp_/Cloud_UI
./start.sh
# http://127.0.0.1:8188
```

Development:

```bash
python3 backend/server.py        # API on :8188
cd frontend && npm run dev       # UI on :5173 (proxies /api)
```

## Nodes

| Node | Inputs | Outputs | Purpose |
|---|---|---|---|
| **Model** | — | model | diffusion model preset (FLUX.2 4B/9B, FLUX.3, Z-Image, Anima, Wan) |
| **Text Encoder** | — | te | explicit TE: Qwen3 4B/8B, Qwen3-VL, 0.6B, UMT5, T5, CLIP-L |
| **VAE** | — | vae | explicit VAE: FLUX.2, FLUX.1 AE, Qwen-Image, Wan 2.2, SD1.5, PixArt, Hunyuan |
| **Prompt** | — | prompt | positive / negative |
| **Image Sampler** | model, prompt, te, vae | image | text-to-image |
| **Image Sampler (ref)** | + image | image | Flux reference/edit, or img2img with strength |
| **Wan Sampler** | model, prompt, image, te, vae | video | frames, fps, flow shift, optional i2v |
| **Load Image** | — | image | path or upload |
| **Upscale** | image | image | RealESRGAN / 4x-UltraSharp |
| **Save / Output** | image | — | marks the result as output |

If TE/VAE nodes are not connected, the model preset defaults are used.

## Placement settings

**Settings** (bottom of the node panel):

- **Auto-fit** — sd.cpp decides what to keep in VRAM/RAM (default).
- Manual per-module (`diffusion`, `te`, `vae`):
  - **Compute**: GPU (`vulkan0`) or CPU.
  - **Weights**: VRAM, RAM (loaded to GPU on demand) or Disk.

Maps directly to `--backend` / `--params-backend`.

## UI

- **Right-click a node** → Duplicate / Delete (or press Delete).
- **LOG** — bottom bar like a VS Code terminal; click to expand the live log.
- **Gallery** — modal grid with previews, size, Open and "Use as input"
  (adds a Load Image node with that file).
- Nodes are grouped in collapsible sections in the left panel.
- Workflows are stored in `workflows/`, results in `outputs/`.

## API

- `GET /api/config` — models, text encoders, VAEs, upscalers, defaults
- `POST /api/jobs` — `{graph, name}` → job
- `GET /api/jobs/{id}` — status, progress, outputs
- `GET /api/jobs/{id}/log?since=N` — incremental log
- `POST /api/jobs/{id}/cancel`
- `GET /api/outputs`, `/files/<path>`
- `GET/POST /api/workflows[/{name}]`
- `POST /api/upload` — `{name, data(base64)}` (normalized to PNG)

## Architecture

```
frontend (React 19 + @xyflow/react + Vite)
        │ REST
backend/server.py   (stdlib HTTP, static files)
        │ queue (single GPU worker)
backend/executor.py → sd-cli (Vulkan)
```

See [readme_ru.md](readme_ru.md) for the Russian version.

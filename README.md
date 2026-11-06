# Cloud_UI

Нодовый веб-редактор в духе ComfyUI. Бэкенд — `sd.cpp` (`sd-cli`), всё считается
локально на этой машине.

## Запуск

```bash
cd /home/nik/Projects/opencode/sd_cpp_/Cloud_UI
./start.sh
# http://127.0.0.1:8188
```

Разработка:

```bash
python3 backend/server.py            # API :8188
cd frontend && npm run dev           # UI :5173 (proxy на API)
```

## Ноды

| Нода | Входы | Выходы | Назначение |
|---|---|---|---|
| **Model** | — | model | diffusion-модель (FLUX.2 4B/9B, FLUX.3, Z-Image, Anima, Wan) |
| **Text Encoder** | — | te | явный TE: Qwen3 4B/8B, Qwen3-VL, 0.6B, UMT5, T5, CLIP-L |
| **VAE** | — | vae | явный VAE: FLUX.2, FLUX.1 AE, Qwen-Image, Wan 2.2, SD1.5 и др. |
| **Prompt** | — | prompt | positive / negative |
| **Image Sampler** | model, prompt, te, vae | image | text-to-image |
| **Image Sampler (ref)** | + image | image | reference/edit (Flux) или img2img + strength |
| **Wan Sampler** | model, prompt, image, te, vae | video | видео: frames, fps, flow shift |
| **Load Image** | — | image | путь или загрузка файла |
| **Upscale** | image | image | ESRGAN: RealESRGAN / 4x-UltraSharp |
| **Save / Output** | image | — | фиксация результата |

Если TE/VAE не подключены — берутся дефолты выбранной модели.

## Настройки размещения

Кнопка **⚙ Settings**:

- **Auto-fit** — sd.cpp сам решает, что держать в VRAM/RAM (по умолчанию).
- Либо ручной режим по модулям `diffusion / te / vae`:
  - **Compute**: `GPU (vulkan0)` или `CPU`.
  - **Weights**: `VRAM`, `RAM` (подгружать на GPU по мере надобности) или `Disk`.

Это напрямую транслируется в `--backend` и `--params-backend` sd-cli.

## Прочее

- **Правый клик по ноде** → Duplicate / Delete node (или клавиша Delete).
- **LOG** — узкая панель слева с иконкой терминала; клик открывает/закрывает
  консоль с живым логом и прогрессом.
- **Gallery** — отдельное модальное окно с сеткой карточек: превью, размер,
  Open, Use as input (добавляет Load Image с этим файлом).
- Воркфлоу сохраняются в `workflows/`, результаты — в `outputs/`.

## API

- `GET /api/config` — модели, TE, VAE, апскейлеры, дефолтные настройки
- `POST /api/jobs` — `{graph, name}` → задача
- `GET /api/jobs/{id}` — статус, прогресс, результаты
- `GET /api/jobs/{id}/log?since=N` — инкрементальный лог
- `POST /api/jobs/{id}/cancel`
- `GET /api/outputs`, `/files/<path>`
- `GET/POST /api/workflows[/{name}]`
- `POST /api/upload` — `{name, data(base64)}`

## Архитектура

```
frontend (React 19 + @xyflow/react + Vite)
        │ REST
backend/server.py   (stdlib HTTP, static)
        │ queue (single GPU worker)
backend/executor.py → sd-cli (Vulkan)
```

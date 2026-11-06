# Cloud_UI

Нодовый редактор в духе ComfyUI для [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp).
Всё считается локально; бэкенд запускает `sd-cli`.

## Запуск

```bash
cd /home/nik/Projects/opencode/sd_cpp_/Cloud_UI
./start.sh
# http://127.0.0.1:8188
```

Разработка:

```bash
python3 backend/server.py        # API :8188
cd frontend && npm run dev       # UI :5173 (proxy на /api)
```

## Ноды

| Нода | Входы | Выходы | Назначение |
|---|---|---|---|
| **Model** | — | model | diffusion-модель (FLUX.2 4B/9B, FLUX.3, Z-Image, Anima, Wan) |
| **Text Encoder** | — | te | явный TE: Qwen3 4B/8B, Qwen3-VL, 0.6B, UMT5, T5, CLIP-L |
| **VAE** | — | vae | явный VAE: FLUX.2, FLUX.1 AE, Qwen-Image, Wan 2.2, SD1.5, PixArt, Hunyuan |
| **Prompt** | — | prompt | positive / negative |
| **Image Sampler** | model, prompt, te, vae | image | text-to-image |
| **Image Sampler (ref)** | + image | image | reference/edit (Flux) или img2img со strength |
| **Wan Sampler** | model, prompt, image, te, vae | video | frames, fps, flow shift, опционально i2v |
| **Load Image** | — | image | путь или загрузка файла |
| **Upscale** | image | image | RealESRGAN / 4x-UltraSharp |
| **Save / Output** | image | — | фиксирует результат |

Если TE/VAE не подключены — берутся дефолты выбранной модели.

## Настройки размещения

Кнопка **Settings** (внизу панели нод):

- **Auto-fit** — sd.cpp сам решает, что держать в VRAM/RAM (по умолчанию).
- Ручной режим по модулям `diffusion / te / vae`:
  - **Compute**: GPU (`vulkan0`) или CPU.
  - **Weights**: VRAM, RAM (с подгрузкой на GPU) или Disk.

Транслируется в `--backend` / `--params-backend`.

## Интерфейс

- **Правый клик по ноде** → Duplicate / Delete (или клавиша Delete).
- **LOG** — нижняя полоса как терминал в VS Code; клик разворачивает живой лог.
- **Gallery** — модальное окно с сеткой: превью, размер, Open, Use as input
  (добавляет Load Image с этим файлом).
- Ноды сгруппированы в сворачивающиеся разделы слева.
- Воркфлоу хранятся в `workflows/`, результаты — в `outputs/`.

## API

- `GET /api/config` — модели, TE, VAE, апскейлеры, дефолтные настройки
- `POST /api/jobs` — `{graph, name}` → задача
- `GET /api/jobs/{id}` — статус, прогресс, результаты
- `GET /api/jobs/{id}/log?since=N` — инкрементальный лог
- `POST /api/jobs/{id}/cancel`
- `GET /api/outputs`, `/files/<path>`
- `GET/POST /api/workflows[/{name}]`
- `POST /api/upload` — `{name, data(base64)}` (нормализуется в PNG)

## Архитектура

```
frontend (React 19 + @xyflow/react + Vite)
        │ REST
backend/server.py   (stdlib HTTP, static)
        │ queue (один GPU-воркер)
backend/executor.py → sd-cli (Vulkan)
```

Английская версия: [README.md](README.md).

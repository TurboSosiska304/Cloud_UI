# Cloud_UI

Веб-интерфейс в духе ComfyUI: граф из нод, очередь задач, галерея. Бэкенд —
`sd.cpp` (`sd-cli`), запускается локально на этой машине.

## Запуск

```bash
cd /home/nik/Projects/opencode/sd_cpp_/Cloud_UI
./start.sh
# http://127.0.0.1:8188
```

Для разработки (горячая перезагрузка фронтенда):

```bash
python3 backend/server.py            # бэкенд :8188
cd frontend && npm run dev           # фронтенд :5173 (proxy на API)
```

## Ноды

| Нода | Входы | Выходы | Что делает |
|---|---|---|---|
| **Model** | — | model | выбор пресета (FLUX.2 4B/9B, FLUX.3, Z-Image, Anima, Wan) |
| **Prompt** | — | prompt | positive / negative |
| **Sampler** | model, prompt, image | image | запускает `sd-cli`; `image` — референс (Flux) или img2img |
| **Load Image** | — | image | путь к файлу или загрузка |
| **Upscale** | image | image | ESRGAN (`RealESRGAN_x4plus`, `4x-UltraSharp`) |
| **Save** | image | — | фиксирует результат в галерее |

Кнопки **Templates** слева: txt2img (быстрый), txt2img FLUX.3, edit по референсу,
upscale.

## API

- `GET /api/config` — модели, апскейлеры
- `POST /api/jobs` — `{graph, name}` → задача
- `GET /api/jobs/{id}` — статус, прогресс, хвост лога, результаты
- `POST /api/jobs/{id}/cancel`
- `GET /api/outputs` — галерея
- `GET/POST /api/workflows[/{name}]` — сохранение графов
- `POST /api/upload` — `{name, data(base64)}`
- `/files/<path>` — файлы результатов

## Архитектура

```
frontend (React + @xyflow/react)
        │ REST
backend/server.py  (stdlib HTTP)
        │ queue
backend/executor.py → sd-cli (Vulkan)
```

Задачи выполняются последовательно (одна GPU). Прогресс парсится из логов
`sd-cli`, результаты складываются в `outputs/`.

## Ограничения MVP

- Ноды пока линейные: model → prompt → sampler → save (плюс upscale/ref).
- Видео Wan поддерживается (sampler с пресетом Wan), но без отдельной ноды
  тайминга/кадров — параметры в Sampler.
- Нет авторизации: сервер слушает только `127.0.0.1`.

# Live Simulator

Production-only PWA для симуляции вертикального прямого эфира. Приложение показывает локальную камеру или видео, моделирует зрителей, лайки и реакции, распознаёт речь ведущего и создаёт контекстные комментарии.

Проект не связан с TikTok. TikTok и связанные обозначения принадлежат соответствующим правообладателям.

## Как работает приложение

- React отвечает за экран подготовки и live-интерфейс.
- Dexie хранит настройки, аватар и выбранное видео только в браузере устройства.
- Локальные движки управляют зрителями, лайками, реакциями, авторами, диалогами и расписанием комментариев.
- Deepgram получает поток микрофона и возвращает завершённые фрагменты распознанной речи.
- Одна модель Mistral анализирует текущий кадр и контекст разговора, другая формирует текст для заранее подготовленных слотов комментариев.
- Fastify хранит ключи провайдеров на серверной стороне. Браузер обращается только к same-origin `/api/*`.

Явная просьба задавать вопросы создаёт одну ограниченную пачку из двух или трёх конкретных вопросов. Старые ветки диалога не могут вытеснить эту пачку. Ответ ведущего связывается со зрителем только при однозначной адресации; совпадение по времени само по себе не считается ответом.

В запросах нет машинного сигнала о качестве звука. Распознанный текст подтверждает только содержание речи, поэтому модель не имеет права утверждать, что ведущего плохо слышно, звук пропадает или микрофон неисправен. Такие утверждения блокируются предметной валидацией.

Распознавание предмета использует свежий кадр и состояния `none -> uncertain -> confirmed`. Первое наблюдение не становится фактом: подтверждение требует совпадающего результата на следующем кадре. При недостаточной видимости приложение не угадывает предмет.

Подробности: [архитектура](docs/ARCHITECTURE.md), [модель данных](docs/DATA_MODEL.md), [текущее состояние](STATUS.md).

## Требования

- Docker с Docker Compose v2 и BuildKit;
- домен и внешний HTTPS reverse proxy;
- отдельные ключи Mistral и Deepgram;
- доступ контейнера API к HTTPS и WSS провайдеров.

Development-сервер, HMR, bind mounts и development Compose-профиль не поддерживаются. Проверки и production-сборка выполняются в Docker.

## Конфигурация

Скопируйте `.env.example` в `.env` и заполните все значения. `.env` не должен попадать в Git, Docker build context, логи или frontend bundle.

```dotenv
APP_DOMAIN=
MISTRAL_API_KEY=
MISTRAL_API_BASE_URL=
MISTRAL_CONTEXT_MODEL=
MISTRAL_COMMENT_MODEL=
DEEPGRAM_API_KEY=
DEEPGRAM_STREAMING_BASE_URL=
DEEPGRAM_MODEL=
DEEPGRAM_LANGUAGE_HINT=
DEEPGRAM_EOT_THRESHOLD=
DEEPGRAM_EOT_TIMEOUT_MS=
E2E_BASE_URL=
```

Runtime-переменные обязательны для `compose.yaml`; `E2E_BASE_URL` дополнительно обязателен только для verify-прохода. Значений по умолчанию нет. API при старте проверяет адреса, идентификаторы моделей, границы end-of-turn и реальные возможности провайдеров, не возвращая ключи в health response.

## Сборка и запуск

Сборка не требует `.env` и не передаёт credentials в build. Docker Compose может автоматически прочитать существующий `.env` для интерполяции, поэтому храните в нём только runtime-конфигурацию и не добавляйте файл в Git:

```bash
docker compose -f compose.build.yaml config --quiet
docker compose -f compose.build.yaml build --pull
```

Production runtime:

```bash
docker compose config --quiet
docker compose up -d --force-recreate --remove-orphans
docker compose ps
docker compose logs --no-color api app
curl -fsS https://YOUR_DOMAIN/api/v1/health
```

`app` публикуется только на `127.0.0.1:18080`. TLS завершается внешним Nginx. Перед установкой шаблона [deploy/nginx/live.conf.template](deploy/nginx/live.conf.template) замените `__APP_DOMAIN__` на свой домен и настройте сертификат. WebSocket `/api/v1/transcriptions/stream` должен передаваться с Upgrade-заголовками.

Проверка уже запущенного production URL:

```bash
docker compose -f compose.yaml -f compose.verify.yaml build e2e
docker compose -f compose.yaml -f compose.verify.yaml run --rm e2e
docker compose -f compose.yaml -f compose.verify.yaml run --rm e2e smoke:ai
docker compose -f compose.yaml -f compose.verify.yaml run --rm --entrypoint node e2e tests/smoke/visual-grounding-live.mjs
```

Соберите образ `e2e` перед первым verify-проходом и после изменения `Dockerfile`, lock-файла или тестов.

Оба smoke-сценария обращаются к реальным Mistral API и расходуют квоту. Остановка контейнеров не удаляет named volumes:

```bash
docker compose down
```

## Безопасность и приватность

У публичного API нет пользовательской аутентификации. Same-origin проверка и rate limit уменьшают злоупотребления, но не определяют владельца запроса. Публикуйте сервис без дополнительного upstream access control только если открытое использование вашей провайдерской квоты допустимо.

Профиль, аватар и выбранное видео сохраняются в IndexedDB только для текущей пары браузер/origin. Встроенного экспорта IndexedDB нет: очистка данных сайта необратимо удалит профиль и media. API не сохраняет кадры, PCM-аудио, распознанный текст, semantic context и комментарии. Кадры и ограниченный контекст передаются Mistral, аудио передаётся Deepgram. Логи содержат только операционные метаданные и коды валидации.

App shell доступен офлайн, но распознавание речи, анализ кадра и генерация комментариев требуют сети. Для установки на iPhone откройте HTTPS URL в Safari и выберите **Поделиться -> На экран «Домой»**.

## Лицензии

Код распространяется по MIT License. Портреты в `src/assets/personas/portraits` используются по отдельному разрешению и не перелицензируются по MIT; сведения об источниках находятся в `src/assets/personas/LICENSES.json`.

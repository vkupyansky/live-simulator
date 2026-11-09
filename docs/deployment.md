# Развёртывание

Все команды выполняются из корня репозитория. Поддерживается production-сборка в Docker; development-сервер, HMR и bind mounts не предусмотрены.

## Конфигурация

Нужны Docker Compose v2 с BuildKit, собственный домен, внешний HTTPS reverse proxy, отдельные ключи Mistral/Deepgram и исходящий HTTPS/WSS из API-контейнера.

Скопируйте [.env.example](../.env.example) в `.env` и заполните:

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

Runtime-параметры обязательны для `compose.yaml`; `E2E_BASE_URL` нужен только для проверки развёрнутого приложения. Значений по умолчанию нет. API при старте проверяет адреса, модели, границы end-of-turn и реальные возможности провайдеров, не раскрывая ключи в health response.

Секреты остаются только в runtime environment API. `.env` не должен попадать в Git, build context, build arguments, логи или frontend bundle.

## Сборка и запуск

Сборка не требует credentials. Compose может автоматически прочитать существующий `.env` для интерполяции, поэтому храните в нём только runtime-конфигурацию:

```bash
docker compose -f compose.build.yaml config --quiet
docker compose -f compose.build.yaml build --pull
docker compose config --quiet
docker compose up -d --force-recreate --remove-orphans
docker compose ps
docker compose logs --no-color api app
curl -fsS https://YOUR_DOMAIN/api/v1/health
```

`app` публикуется только на `127.0.0.1:18080`. TLS завершает внешний Nginx. Перед установкой [шаблона Nginx](../deploy/nginx/live.conf.template) замените `__APP_DOMAIN__`, настройте сертификат и передачу Upgrade-заголовков для WebSocket `/api/v1/transcriptions/stream`.

Пользовательской аутентификации нет. Same-origin и rate limit не заменяют проверку владельца. Ограничьте доступ на внешнем proxy, если открытое использование провайдерской квоты недопустимо. Проверка сертификатов исходящих HTTPS/WSS остаётся включённой.

## Остановка и данные

```bash
docker compose down
```

Остановка не удаляет named volumes. Профиль, аватар и видео хранятся в IndexedDB браузера, а не в серверной БД. Смена origin создаёт отдельное хранилище; очистка данных сайта необратима. Подробности находятся в [модели данных](data-model.md), проверки развёрнутого URL в [тестировании](testing.md).

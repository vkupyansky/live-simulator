# Политика безопасности

## Поддерживаемая версия

Исправления безопасности применяются к текущей версии default branch.

## Сообщение об уязвимости

Не публикуйте уязвимости в обычных issues. Используйте GitHub Private Vulnerability Reporting и укажите версию, воспроизведение, влияние и предлагаемое исправление. Не прикладывайте реальные media, аудио, transcript, provider response или credentials.

## Границы доверия

Ключи `MISTRAL_API_KEY` и `DEEPGRAM_API_KEY` должны существовать только в runtime environment API-контейнера. Их нельзя помещать в frontend, build arguments, committed files, логи, health response или тестовые fixtures. При подозрении на раскрытие ключ необходимо перевыпустить.

API не сохраняет и не логирует кадры, PCM, transcript, media пользователя, полные model responses и authorization headers. Допустимы только request id, model id, длительность, размеры и агрегированные коды валидации.

Same-origin validation и rate limit не являются пользовательской аутентификацией. У текущего API нет аккаунтов и проверки владельца. Открытый production URL позволяет расходовать provider quota через интерфейс приложения; при недопустимости этого риска доступ следует ограничить на внешнем reverse proxy.

Fastify проверяет origin, schema, размер, тип WebSocket payload и idempotency key. Caddy устанавливает CSP, framing, MIME, referrer и permissions policy. Внешний Nginx завершает TLS, сохраняет security headers и передаёт WebSocket Upgrade; его loopback-соединение с Caddy использует HTTP по `127.0.0.1`. Сертификаты обязательно проверяются на исходящих HTTPS/WSS-соединениях с облачными провайдерами.

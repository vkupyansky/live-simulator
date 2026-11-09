# Инструкции проекта

## Назначение

Live Simulator является production-only PWA с внутренним Fastify API. Сохраняйте работающее поведение, данные IndexedDB и приватность media. Не добавляйте development runtime, HMR, bind mounts, fallback-конфигурацию и legacy-ветки.

## Навигация

- `src/components`: setup и live UI;
- `src/features`: domain engines, media, AI, speech и session lifecycle;
- `src/db`: единственный durable state;
- `api`: same-origin API и adapters Mistral/Deepgram;
- `tests`: unit, component, API, smoke и WebKit;
- `docs`: архитектура и модель данных;
- `compose.build.yaml`: воспроизводимая сборка без runtime credentials;
- `compose.yaml`: production runtime;
- `compose.verify.yaml`: одноразовая проверка production URL.

## Правила изменений

- React хранит только UI, бизнес-логика остаётся в domain-модулях.
- Zustand используется только для активной сессии, Dexie только для persistent state.
- Внешние данные проходят Zod и предметную валидацию на границе.
- Все очереди, timers, listeners, streams, object URLs и histories должны быть ограничены и освобождаться.
- Не ослабляйте TypeScript, ESLint, CSP, same-origin checks и tests ради зелёного результата.
- Не добавляйте секреты, transcript, provider responses, media пользователя и реальные production hosts.
- При замене реализации удаляйте старый код, зависимости, стили, tests и docs.
- Обновляйте `README.md`, `STATUS.md` и профильные документы вместе с поведением.

## Команды

```bash
docker compose -f compose.build.yaml config --quiet
docker compose -f compose.build.yaml build --pull
```

Runtime требует полностью заполненный `.env`:

```bash
docker compose config --quiet
docker compose up -d --force-recreate --remove-orphans
docker compose ps
docker compose logs --no-color api app
```

Verify выполняется только против обязательного production URL:

```bash
docker compose -f compose.yaml -f compose.verify.yaml run --rm e2e
```

Warnings являются errors. Не запускайте Vite dev server и локальные package-manager проверки как замену Docker workflow.

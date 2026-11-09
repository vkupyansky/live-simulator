# Live Simulator: правила разработки

## Навигация

- `src/components`: подготовка эфира и live-интерфейс.
- `src/features`: предметные движки, media, анализ кадров, комментарии, речь и жизненный цикл сессии.
- `src/db`: долговременное состояние; `api`: same-origin API и интеграции Mistral/Deepgram.
- `tests`: unit, component, API, smoke и WebKit.
- `compose.build.yaml`: сборка без runtime credentials; `compose.yaml`: runtime; `compose.verify.yaml`: проверка production URL.
- [Архитектура](docs/architecture.md), [данные](docs/data-model.md), [развёртывание](docs/deployment.md), [тестирование](docs/testing.md), [состояние](STATUS.md).

## Инварианты

- Сохраняйте production-only runtime, данные IndexedDB и приватность media. Development-сервер, HMR, bind mounts, fallback-конфигурация и legacy-ветки не добавляются.
- React хранит UI, предметная логика остаётся в отдельных модулях. Zustand содержит только активную сессию, Dexie только постоянное состояние.
- Внешние данные проходят Zod и предметную валидацию. Все очереди, timers, listeners, streams, object URLs и histories ограничены и освобождаются.
- Не ослабляйте TypeScript, ESLint, CSP, same-origin и тесты. Предупреждения считаются ошибками.
- Не публикуйте секреты, расшифровки, ответы провайдеров, пользовательские media и реальные production hosts.
- Удаляйте заменённые код, настройки и документы. Обновляйте README, STATUS и профильные контракты вместе с поведением.

## Проверки

Основная команда находится в [README](README.md#проверки). Полные команды production-сборки, проверки развёрнутого URL и платных smoke находятся в [тестировании](docs/testing.md).

Не заменяйте Docker workflow локальными package-manager проверками или Vite dev server. Изменения UI проверяются в WebKit при viewport 430 × 932. Visual snapshot обновляется только при изменении соответствующего экрана.

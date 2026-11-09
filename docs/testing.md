# Тестирование

Команды выполняются из корня репозитория через production Docker workflow. Локальный development runtime не поддерживается.

## Изолированная сборка

```bash
docker compose -f compose.build.yaml config --quiet
docker compose -f compose.build.yaml build --pull
```

Build выполняет Prettier check, ESLint с `--max-warnings 0`, строгий TypeScript, unit/component/API-тесты, production audit и обе production-сборки. Предупреждения считаются ошибками. Runtime credentials для сборки не нужны.

CI также проверяет Caddy configuration, ограниченный состав frontend runtime и исправляемые HIGH/CRITICAL через Trivy для обоих образов. Настройки проверок находятся в [workflow](../.github/workflows/ci.yml).

## Развёрнутое приложение

E2E требует настроенный production URL в `E2E_BASE_URL` и runtime-параметры из [инструкции развёртывания](deployment.md):

```bash
docker compose -f compose.yaml -f compose.verify.yaml build e2e
docker compose -f compose.yaml -f compose.verify.yaml run --rm e2e
```

Соберите `e2e` перед первым запуском и после изменения Dockerfile, lock-файла или тестов. UI проверяется в WebKit при viewport 430 × 932; snapshot обновляется только при изменении соответствующего экрана.

## Реальные провайдеры

Следующие smoke обращаются к настоящему Mistral API и расходуют квоту:

```bash
docker compose -f compose.yaml -f compose.verify.yaml run --rm e2e smoke:ai
docker compose -f compose.yaml -f compose.verify.yaml run --rm --entrypoint node e2e tests/smoke/visual-grounding-live.mjs
```

Изолированные тесты и сборка не доказывают доступность production health, внешних провайдеров или полный сценарий живого эфира. Текущее состояние описано в [STATUS.md](../STATUS.md).

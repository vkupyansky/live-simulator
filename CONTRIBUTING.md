# Участие в разработке

Участие означает согласие с [Code of Conduct](CODE_OF_CONDUCT.md) и распространением вклада по MIT License.

1. Опишите пользовательское изменение, влияние на приватность и способ проверки.
2. Сохраняйте границу durable Dexie state и disposable session state.
3. Держите domain-логику вне React и не дублируйте валидацию границ.
4. Удаляйте заменённый код, настройки и документацию без legacy-веток.
5. Фиксируйте версии точно и обновляйте `pnpm-lock.yaml` осознанно.
6. Не добавляйте `.env`, media пользователя, логи, отчёты и provider payloads.

Development-сервер не поддерживается. Каноническая проверка выполняется production build:

```bash
docker compose -f compose.build.yaml config --quiet
docker compose -f compose.build.yaml build --pull
```

Build запускает Prettier check, ESLint с `--max-warnings 0`, строгий TypeScript, unit/component/API tests, production audit и обе production-сборки. E2E запускается отдельно против обязательного `E2E_BASE_URL` уже развёрнутого приложения:

```bash
docker compose -f compose.yaml -f compose.verify.yaml run --rm e2e
```

UI-изменения должны проходить WebKit при viewport 430 × 932. Не обновляйте visual snapshot, если изменение не относится к соответствующему экрану.

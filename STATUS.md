# Текущее состояние

Дата: 2026-11-09

## Реализовано

- production-only PWA с камерой и локальным видео;
- device-local настройки и media в IndexedDB;
- ограниченные viewer, like, reaction и comment engines;
- streaming speech через Deepgram;
- Mistral context/vision и structured comment generation;
- точные host/viewer и редкие viewer/viewer диалоги;
- conservative visual grounding с подтверждением на следующем кадре;
- одноразовые topic/question intents и очистка предыдущей темы;
- domain validation визуальных, аудио и повторяющихся утверждений;
- bounded backoff без остановки live session;
- offline app shell, iOS safe-area и WebKit E2E;
- production Docker images для frontend и API.

## Проверки release-кандидата

- build и runtime Compose config: успешно;
- обе production image build: успешно;
- Prettier, ESLint без warnings, frontend/API TypeScript: успешно;
- unit/component/API tests: 181 из 181 успешно;
- production dependency audit: известных уязвимостей нет;
- Trivy для обоих образов: исправляемых HIGH/CRITICAL не найдено;
- Caddy configuration validation и проверка состава frontend runtime: успешно;
- Gitleaks и проверка состава Git: утечек не обнаружено.

Подготовка репозитория не изменяет работающее серверное развёртывание. Production health, реальные Mistral smoke и Playwright против сервера в этом проходе повторно не запускались. Они выполняются отдельными командами из README и требуют настроенного production URL.

## Ограничения

- cloud-функции требуют сети и действующих Mistral/Deepgram credentials;
- API не имеет пользовательской аутентификации;
- система не измеряет качество аудио и не может оценивать микрофон;
- Flux не выполняет speaker diarization;
- vision намеренно возвращает неопределённость вместо догадки;
- встроенного экспорта IndexedDB нет;
- TLS и HSTS обеспечивает внешний Nginx.

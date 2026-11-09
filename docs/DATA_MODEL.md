# Модель данных

## Долговременное состояние устройства

Dexie database `live-simulator` содержит две таблицы:

- `settings`: одна запись `BroadcastSettings` с ключом `broadcast`;
- `blobs`: обработанный аватар и необязательное локальное видео, индексированные по `id`, `kind`, `createdAt`.

```text
BroadcastSettings
|- key: "broadcast"
|- schemaVersion: 5
|- avatarBlobId: string
|- displayName: string
|- username: string
|- source: camera | video(mediaBlobId)
|- targetViewers: integer, 1..999999
|- activity: low | normal | high
`- speechAnalysisEnabled: boolean
```

Сохранение выполняется транзакционно. После успешной записи удаляются Blob, на которые больше не ссылается конфигурация. Идентификаторы cloud-моделей являются обязательной deployment-конфигурацией и не хранятся в IndexedDB.

Пользовательские media не загружаются на сервер и не входят в репозиторий. Встроенного экспорта IndexedDB нет, поэтому перед очисткой данных сайта исходные аватар и видео следует сохранить отдельно. Удаление site data необратимо удаляет конфигурацию и Blob этого устройства.

## Состояние активной сессии

```text
RuntimeBroadcast
|- sessionId и seed
|- displayName, username и avatar URL
|- camera stream или video object URL
|- target/current viewers и activity
`- speechAnalysisEnabled

SemanticContext
|- sceneSummary и conversationSummary
|- topic, hostIntent, topicResetSequence
|- hostTarget: none | audience | open viewer dialogue
|- presenterContext: primary и до двух временных guests
|- visualGrounding: none | uncertain | confirmed
`- bounded audienceDirection

AudiencePersona
|- session-local id, username, display name и avatar seed
|- primary language
`- casing, tone и probability weights

CommentSlot
|- slotId, personaId, language, kind, length, casing
|- allowEmoji, allowTypo, allowVisualClaim
`- необязательные dialogueId, action и точный reply target
```

Машинного поля качества аудио в `SemanticContext` нет. Transcript хранит только нормализованный текст, относительное время и язык.

## Лимиты

- 5 000 уникальных username в локальном каталоге;
- до 24 personas и 24 slots в generation request;
- до трёх host-dialogue веток и шести ходов в каждой;
- до трёх presenter slots;
- до двух visual-claim slots в пачке;
- до 300 novelty texts;
- до 100 live comments и 100 элементов scheduler queue;
- до 18 transcript segments;
- lifetime host-dialogue 120 секунд.

Явная просьба задавать вопросы резервирует два или три question slots. `topicResetSequence` разделяет disposable context на эпохи; данные старой эпохи удаляются до принятия следующей пачки.

Audience personas, comments, frames, PCM, transcript, semantic context и model responses не записываются в IndexedDB и не сохраняются Fastify. Остановка сессии удаляет runtime state и освобождает media resources.

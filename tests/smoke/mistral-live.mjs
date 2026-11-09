import { readFile } from 'node:fs/promises';
import process from 'node:process';

const baseUrlValue = process.env.E2E_BASE_URL;
if (!baseUrlValue?.trim()) throw new Error('E2E_BASE_URL is required');
const baseUrl = new URL(baseUrlValue);
const sessionId = `smoke_${Date.now()}`;
const headers = (operation) => ({
  'content-type': 'application/json',
  'idempotency-key': `${sessionId}:${operation}`,
  origin: baseUrl.origin,
});
const probeImage = JSON.parse(
  await readFile(new URL('../../api/probeImage.json', import.meta.url), 'utf8'),
);
if (typeof probeImage.dataUrl !== 'string') throw new Error('Probe image is invalid');
const frameDataUrl = probeImage.dataUrl;
const frameByteLength = Buffer.from(frameDataUrl.split(',')[1] ?? '', 'base64').byteLength;
const frameMetadata = {
  width: 32,
  height: 32,
  byteLength: frameByteLength,
  meanLuminance: 0.5,
  luminanceDeviation: 0.25,
  darkPixelRatio: 0.2,
  clippedBlackRatio: 0.05,
};
const transcriptSegments = [
  {
    sequence: 1,
    text: 'меня слышно? позадавайте мне вопросы о путешествиях',
    startedAtMs: 0,
    endedAtMs: 2_400,
    language: 'ru',
  },
];
const emptyContext = {
  sceneSummary: '',
  conversationSummary: '',
  topic: '',
  topicResetSequence: 0,
  hostIntent: 'ambient',
  hostTarget: {
    type: 'none',
    transcriptSequence: 0,
    dialogueId: '',
    turnId: '',
    personaId: '',
  },
  presenterContext: {
    visibleCount: 0,
    participants: [
      {
        id: 'primary',
        label: 'Ведущий',
        labelSource: 'configured',
        visible: false,
        visualAnchor: '',
      },
    ],
    event: 'none',
    eventParticipantId: 'none',
    eventCue: '',
    complimentTargetId: 'none',
    complimentCue: '',
  },
  visualGrounding: {
    status: 'none',
    label: '',
    transcriptSequence: 0,
    frameSequence: 0,
  },
  audienceDirection: {
    reactToSpeech: false,
    questionShare: 0.08,
    suggestedTopics: [],
    keyFacts: [],
  },
};

async function post(path, operation, payload) {
  const response = await fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: headers(operation),
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    const code = body?.error?.code;
    throw new Error(`${path} failed with HTTP ${response.status}${code ? ` (${code})` : ''}`);
  }
  return body;
}

const shared = {
  sessionId,
  currentViewers: 100,
  targetViewers: 100,
  activity: 'normal',
  host: { displayName: 'Ведущий', username: 'host.live' },
};
const semanticContext = await post('/api/v1/context/analyze', 'context', {
  ...shared,
  sequence: 1,
  transcriptSegments,
  newTranscriptSequences: [1],
  recentComments: [],
  openDialogues: [],
  previousContext: emptyContext,
  frameDataUrl,
  frameMetadata,
  sceneChanged: true,
  transcriptChanged: true,
});

const unsupportedAudioClaim =
  /(?:слышн\p{L}*|микрофон\p{L}*|звук\p{L}*.{0,16}(?:плох|хорош|тих|громк|пропад|лаг)|can(?:not|'t)?\s+hear|\bmic(?:rophone)?\b|\bsound\b.{0,16}(?:bad|good|quiet|loud|cutting|lag))/iu;
if (unsupportedAudioClaim.test(JSON.stringify(semanticContext)))
  throw new Error('Semantic context contains an unsupported audio-quality claim');

const persona = {
  id: 'persona_smoke_ru',
  username: 'quiet.frame',
  displayName: 'Тихий кадр',
  avatarSeed: 'smoke-avatar-seed',
  primaryLanguage: 'ru',
  style: {
    casing: 'lower',
    language: 'ru',
    tone: 'question',
    typoProbability: 0.08,
    emojiProbability: 0.04,
    activityWeight: 1,
  },
};
const batch = await post('/api/v1/comments/generate', 'comments', {
  ...shared,
  sequence: 2,
  personas: [persona],
  slots: [
    {
      slotId: 'slot_smoke_1',
      personaId: persona.id,
      language: 'ru',
      kind: 'question',
      length: 'medium',
      casing: 'lower',
      allowEmoji: false,
      allowTypo: true,
      allowVisualClaim: false,
      instruction: 'Задай естественный вопрос по теме разговора, не копируя ведущего.',
      dialogueId: 'dialogue_smoke_1',
      dialogueAction: 'ask_host',
      replyTarget: { type: 'host', transcriptSequence: 1 },
    },
  ],
  recentComments: [],
  noveltyTexts: [],
  personaMemories: [],
  openDialogues: [],
  transcriptSegments,
  semanticContext,
});

if (!Array.isArray(batch?.comments) || batch.comments.length !== 1)
  throw new Error('Validated comment batch must contain exactly one comment');
const comment = batch.comments[0];
if (
  comment?.slotId !== 'slot_smoke_1' ||
  comment?.personaId !== persona.id ||
  comment?.language !== 'ru' ||
  comment?.kind !== 'question' ||
  comment?.dialogueId !== 'dialogue_smoke_1' ||
  comment?.dialogueAction !== 'ask_host' ||
  comment?.replyTarget?.type !== 'host' ||
  typeof comment?.text !== 'string' ||
  comment.text.length === 0 ||
  comment.text.length > 64
)
  throw new Error('Validated comment batch does not match the public response schema');
if (unsupportedAudioClaim.test(comment.text))
  throw new Error('Generated comment contains an unsupported audio-quality claim');

const replyTranscript = [
  ...transcriptSegments,
  {
    sequence: 2,
    text: 'интересный вопрос, я бы выбрал поездку летом',
    startedAtMs: 3_000,
    endedAtMs: 5_200,
    language: 'ru',
  },
];
const openDialogues = [
  {
    dialogueId: 'dialogue_smoke_1',
    personaId: persona.id,
    displayName: persona.displayName,
    username: persona.username,
    language: 'ru',
    status: 'awaiting_host',
    turns: [
      {
        turnId: 'slot_smoke_1',
        role: 'viewer',
        personaId: persona.id,
        text: comment.text,
        replyToTurnId: '',
      },
    ],
  },
];
const replyContext = await post('/api/v1/context/analyze', 'context-reply', {
  ...shared,
  sequence: 3,
  transcriptSegments: replyTranscript,
  newTranscriptSequences: [2],
  recentComments: [{ personaId: persona.id, text: comment.text }],
  openDialogues,
  previousContext: semanticContext,
  frameDataUrl,
  frameMetadata,
  sceneChanged: false,
  transcriptChanged: true,
});
if (
  replyContext?.hostTarget?.type !== 'viewer' ||
  replyContext.hostTarget.dialogueId !== 'dialogue_smoke_1' ||
  replyContext.hostTarget.turnId !== 'slot_smoke_1' ||
  replyContext.hostTarget.personaId !== persona.id
)
  throw new Error('Context model did not resolve the exact open viewer dialogue');

const followUp = await post('/api/v1/comments/generate', 'comments-reply', {
  ...shared,
  sequence: 4,
  personas: [persona],
  slots: [
    {
      slotId: 'slot_smoke_2',
      personaId: persona.id,
      language: 'ru',
      kind: 'reaction',
      length: 'short',
      casing: 'lower',
      allowEmoji: false,
      allowTypo: false,
      allowVisualClaim: false,
      instruction: 'Коротко и естественно отреагируй на ответ ведущего.',
      dialogueId: 'dialogue_smoke_1',
      dialogueAction: 'acknowledge_host',
      replyTarget: { type: 'host', transcriptSequence: 2 },
    },
  ],
  recentComments: [{ personaId: persona.id, text: comment.text }],
  noveltyTexts: [comment.text],
  personaMemories: [
    { personaId: persona.id, recentMessages: [comment.text], participationCount: 1 },
  ],
  openDialogues,
  transcriptSegments: replyTranscript,
  semanticContext: replyContext,
});
if (
  !Array.isArray(followUp?.comments) ||
  followUp.comments.length !== 1 ||
  followUp.comments[0]?.personaId !== persona.id ||
  followUp.comments[0]?.dialogueId !== 'dialogue_smoke_1' ||
  followUp.comments[0]?.dialogueAction !== 'acknowledge_host'
)
  throw new Error('Same-viewer dialogue follow-up failed public schema validation');

process.stdout.write(
  `${JSON.stringify({ status: 'ok', comments: batch.comments.length + followUp.comments.length, language: comment.language, dialogueTurns: 2, audioGrounding: 'clean' })}\n`,
);

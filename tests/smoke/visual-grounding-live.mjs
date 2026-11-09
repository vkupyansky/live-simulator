import { readFile } from 'node:fs/promises';
import process from 'node:process';

const configuredBaseUrl = process.env.E2E_BASE_URL;
if (!configuredBaseUrl?.trim()) throw new Error('E2E_BASE_URL is required');
const baseUrl = new URL(configuredBaseUrl);
const sessionId = `visual_smoke_${Date.now()}`;
const probeImage = JSON.parse(
  await readFile(new URL('../../api/probeImage.json', import.meta.url), 'utf8'),
);
if (typeof probeImage.dataUrl !== 'string') throw new Error('Probe image is invalid');
const probeByteLength = Buffer.from(probeImage.dataUrl.split(',')[1] ?? '', 'base64').byteLength;
const probeFrameMetadata = {
  width: 32,
  height: 32,
  byteLength: probeByteLength,
  meanLuminance: 0.5,
  luminanceDeviation: 0.25,
  darkPixelRatio: 0.2,
  clippedBlackRatio: 0.05,
};

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

const shared = {
  sessionId,
  currentViewers: 500,
  targetViewers: 500,
  activity: 'normal',
  host: { displayName: 'Ведущий', username: 'host.live' },
};

async function post(path, operation, payload) {
  const response = await fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `${sessionId}:${operation}`,
      origin: baseUrl.origin,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `${path} failed with HTTP ${response.status}${body?.error?.code ? ` (${body.error.code})` : ''}`,
    );
  return body;
}

function containsForbiddenBodyRelation(value) {
  return /(?:смартфон|телефон|часы|устройство).{0,20}(?:на|у|возле).{0,10}(?:лбу|лоб|голове|голова|лице|лицо)|(?:phone|watch|device).{0,20}(?:on|at|near).{0,10}(?:forehead|head|face)/iu.test(
    value,
  );
}

const visualTranscript = [
  {
    sequence: 1,
    text: 'видите, что я показываю? что это такое?',
    startedAtMs: 0,
    endedAtMs: 1_800,
    language: 'ru',
  },
];
const visualContext = await post('/api/v1/context/analyze', 'visual-context', {
  ...shared,
  sequence: 1,
  transcriptSegments: visualTranscript,
  newTranscriptSequences: [1],
  recentComments: [],
  openDialogues: [],
  previousContext: emptyContext,
  frameDataUrl: probeImage.dataUrl,
  frameMetadata: probeFrameMetadata,
  sceneChanged: true,
  transcriptChanged: true,
});

if (visualContext?.visualGrounding?.status === 'confirmed')
  throw new Error('A first visual frame must never produce confirmed grounding');
const visualFields = [
  visualContext?.sceneSummary,
  visualContext?.conversationSummary,
  visualContext?.topic,
  visualContext?.visualGrounding?.label,
  ...(visualContext?.audienceDirection?.keyFacts ?? []),
];
if (visualFields.some((value) => containsForbiddenBodyRelation(String(value ?? ''))))
  throw new Error('Visual context contains a forbidden object-to-body relation');

const persona = {
  id: 'persona_visual_smoke',
  username: 'quiet.frame',
  displayName: 'Тихий кадр',
  avatarSeed: 'visual-smoke-avatar',
  primaryLanguage: 'ru',
  style: {
    casing: 'lower',
    language: 'ru',
    tone: 'short',
    typoProbability: 0.04,
    emojiProbability: 0.04,
    activityWeight: 1,
  },
};
const allowVisualClaim = visualContext.visualGrounding.status === 'uncertain';
const visualBatch = await post('/api/v1/comments/generate', 'visual-comments', {
  ...shared,
  sequence: 2,
  personas: [persona],
  slots: [
    {
      slotId: 'slot_visual_smoke',
      personaId: persona.id,
      language: 'ru',
      kind: 'reaction',
      length: 'medium',
      casing: 'lower',
      allowEmoji: false,
      allowTypo: false,
      allowVisualClaim,
      instruction: allowVisualClaim
        ? 'Ответь осторожно: предмет не подтверждён, поэтому явно вырази сомнение.'
        : 'Честно скажи, что предмет плохо виден, и не угадывай.',
    },
  ],
  recentComments: [],
  noveltyTexts: [],
  personaMemories: [],
  openDialogues: [],
  transcriptSegments: visualTranscript,
  semanticContext: visualContext,
});
if (!Array.isArray(visualBatch?.comments) || visualBatch.comments.length !== 1)
  throw new Error('Visual comment batch is invalid');
if (containsForbiddenBodyRelation(visualBatch.comments[0]?.text ?? ''))
  throw new Error('Generated visual comment contains a forbidden object-to-body relation');

const resetTranscript = [
  ...visualTranscript,
  {
    sequence: 2,
    text: 'давайте о чём-нибудь другом поговорим',
    startedAtMs: 2_500,
    endedAtMs: 4_200,
    language: 'ru',
  },
];
const resetContext = await post('/api/v1/context/analyze', 'topic-reset', {
  ...shared,
  sequence: 3,
  transcriptSegments: resetTranscript,
  newTranscriptSequences: [2],
  recentComments: [{ personaId: persona.id, text: visualBatch.comments[0].text }],
  openDialogues: [],
  previousContext: visualContext,
  sceneChanged: false,
  transcriptChanged: true,
});
if (
  resetContext?.topicResetSequence !== 2 ||
  resetContext?.hostIntent !== 'request_topics' ||
  resetContext?.visualGrounding?.status !== 'none'
)
  throw new Error('Topic reset did not clear the previous visual grounding');

process.stdout.write(
  `${JSON.stringify({ status: 'ok', firstFrame: visualContext.visualGrounding.status, visualComments: 1, topicReset: true })}\n`,
);

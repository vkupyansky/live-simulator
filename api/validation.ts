import {
  COMMENT_LENGTH_LIMITS,
  generatedCommentOutputSchema,
  semanticContextSchema,
  visualGroundingSchema,
  type CommentGenerationRequest,
  type CommentSlot,
  type ContextAnalysisRequest,
  type GeneratedAudienceComment,
  type GeneratedCommentOutput,
  type SemanticContext,
} from './contracts.js';

const MAX_EMOJI_RUN = 2;
const MAX_REPORTED_ISSUES = 40;
const EMOJI_SEGMENTER = new Intl.Segmenter('und', { granularity: 'grapheme' });
const EMPTY_VISUAL_GROUNDING = {
  status: 'none',
  label: '',
  transcriptSequence: 0,
  frameSequence: 0,
} as const satisfies SemanticContext['visualGrounding'];

export type ValidationIssueCode =
  | 'CONTENT_EMPTY'
  | 'JSON_INVALID'
  | 'ROOT_SCHEMA_INVALID'
  | 'CONTEXT_SCHEMA_INVALID'
  | 'CONTEXT_DOMAIN_INVALID'
  | 'BATCH_EXCEEDS_LIMIT'
  | 'COMMENT_SCHEMA_INVALID'
  | 'SLOT_UNKNOWN'
  | 'SLOT_DUPLICATE'
  | 'SLOT_MISSING'
  | 'PERSONA_UNKNOWN'
  | 'COMMENT_EMPTY'
  | 'COMMENT_TOO_LONG'
  | 'SELF_IDENTITY_COPY'
  | 'LANGUAGE_MISMATCH'
  | 'EMOJI_NOT_ALLOWED'
  | 'EMOJI_EXCESS'
  | 'DUPLICATE_EXACT'
  | 'DUPLICATE_FUZZY'
  | 'TRANSCRIPT_COPY'
  | 'QUESTION_INVITATION_ECHO'
  | 'AUDIO_CLAIM_NOT_GROUNDED'
  | 'VISUAL_BODY_RELATION'
  | 'VISUAL_CLAIM_NOT_ALLOWED'
  | 'VISUAL_CLAIM_UNCERTAIN';

export interface ValidationIssue {
  path: string;
  code: ValidationIssueCode;
}

export interface ContextAnalysisValidation {
  context: SemanticContext | null;
  issues: ValidationIssue[];
}

export interface GeneratedBatchValidation {
  comments: GeneratedAudienceComment[];
  acceptedOutputs: GeneratedCommentOutput[];
  acceptedSlotIds: string[];
  receivedItems: number;
  invalidItems: number;
  issues: ValidationIssue[];
}

function issue(path: string, code: ValidationIssueCode): ValidationIssue {
  return { path, code };
}

function parseJson(
  content: string | null,
): { success: true; data: unknown } | { success: false; issues: ValidationIssue[] } {
  if (!content?.trim())
    return {
      success: false,
      issues: [issue('choices.0.message.content', 'CONTENT_EMPTY')],
    };
  try {
    return { success: true, data: JSON.parse(content) as unknown };
  } catch {
    return { success: false, issues: [issue('root', 'JSON_INVALID')] };
  }
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .replace(/([\p{Extended_Pictographic}])\1{2,}/gu, '$1'.repeat(MAX_EMOJI_RUN))
    .trim();
}

function normalizeFingerprint(value: string): string {
  return normalizeText(value)
    .toLocaleLowerCase('ru')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const VISUAL_OBJECT = String.raw`(?:телефон\p{L}*|смартфон\p{L}*|смарт[-\s]?час\p{L}*|час(?:ы|ов|ам|ами|ах)?|устройств\p{L}*|phone\w*|smartphone\w*|smart[-\s]?watch\w*|watch(?:es)?|device\w*)`;
const BODY_LOCATION = String.raw`(?:(?:на|у|около)\s+(?:лб\p{L}*|голов\p{L}*|лиц\p{L}*)|(?:on|near|by)\s+(?:the\s+)?(?:forehead|head|face))`;
const FORBIDDEN_VISUAL_BODY_RELATION = new RegExp(
  `(?:${VISUAL_OBJECT}.{0,24}${BODY_LOCATION}|${BODY_LOCATION}.{0,24}${VISUAL_OBJECT})`,
  'iu',
);
const UNCERTAIN_VISUAL_LANGUAGE =
  /(?:похож\p{L}*|кажет\p{L}*|вроде|возможно|может\s+быть|не\s+(?:разгляд\p{L}*|видно|уверен\p{L}*)|looks?\s+like|seems?|maybe|might|could\s+be|can(?:not|'t)\s+(?:tell|see)|not\s+sure|hard\s+to\s+see)/iu;
const QUESTION_INVITATION_ECHO_RU =
  /^(?:(?:а|ну)\s+)?(?:(?:как(?:ой|ие|ую|их))\s+(?:ещ[её]\s+)?вопрос(?:ы|ов)?(?:\s+(?:по\s+жизни|тебе|вам))?(?:\s+(?:задать|спросить))?|вопрос(?:ы|ики)?(?:\s+по\s+жизни)?|(?:что|о\s+ч[её]м|про\s+что)\s+(?:(?:у\s+)?тебя\s+|вас\s+)?спросить|что\s+(?:тебе\s+|вам\s+)?задать|зада(?:й|вайте)\s+(?:нам\s+)?вопрос(?:ы)?)(?:\s+(?:тогда|ещ[её]))?$/u;
const QUESTION_INVITATION_ECHO_EN =
  /^(?:so\s+)?(?:questions?\s+about\s+life|(?:what|which)\s+questions?(?:\s+about\s+life)?(?:\s+should\s+(?:i|we)\s+ask(?:\s+you)?)?|what\s+(?:should|can)\s+(?:i|we)\s+ask(?:\s+you)?|ask\s+us\s+questions?)$/u;
const UNGROUNDED_VISUAL_QUALITY_CLAIM =
  /(?:(?:слишком|очень|совсем|реально|почти)?\s*темн\p{L}*|(?:ничего|тебя|вас|это|предмет).{0,12}(?:не\s+)?видно|(?:не\s+)?вижу\s+(?:ничего|тебя|вас|это|предмет)|(?:too\s+|very\s+)?dark|(?:can't|cannot|don't)\s+see\s+(?:anything|you|it)|nothing\s+(?:is\s+)?visible)/iu;
const UNGROUNDED_AUDIO_QUALITY_CLAIM =
  /(?:(?:(?:не|плохо|хорошо|нормально|отлично|тихо|громко|еле)\s+)?слышн\p{L}*|(?:не\s+)?слыш(?:у|им|ишь|ите)\s+(?:тебя|вас|его|е[её]|ничего)|(?:звук|аудио).{0,20}(?:пропа\p{L}*|исчез\p{L}*|обрыва\p{L}*|прерыва\p{L}*|лага\p{L}*|заика\p{L}*|тих\p{L}*|громк\p{L}*|плох\p{L}*|хорош\p{L}*|чист\p{L}*|нормальн\p{L}*|задерж\p{L}*)|(?:плох\p{L}*|хорош\p{L}*|чист\p{L}*|тих\p{L}*|громк\p{L}*|нормальн\p{L}*).{0,12}(?:звук|аудио)|(?:(?:что[-\s]?то|проблем\p{L}*|неполад\p{L}*)\s+(?:со|с)\s+|(?:не\s+)?работа\p{L}*.{0,10})(?:звуком|аудио|микрофон\p{L}*)|микрофон\p{L}*.{0,20}(?:(?:не\s+)?работа\p{L}*|выключ\p{L}*|включ\p{L}*|отключ\p{L}*|сломан\p{L}*|глюч\p{L}*|плох\p{L}*|тих\p{L}*)|(?:can|can't|cannot|don't)\s+hear\s+(?:you|me|him|her|anything|nothing|the\s+host)|(?:hear|hearing)\s+(?:you|me|nothing)|(?:no|bad|good|clear|muffled|quiet|loud|choppy|distorted|delayed|laggy)\s+(?:audio|sound)\b|(?:audio|sound).{0,24}(?:cut(?:ting)?\s+out|drop\p{L}*|bad|good|clear|muffled|quiet|loud|choppy|distorted|delay\p{L}*|lag\p{L}*)|(?:mic|microphone).{0,20}(?:muted|unmuted|off|broken|(?:not\s+)?working|works?|cutting\s+out|bad|quiet)|(?:something\s+wrong|issues?|problems?).{0,16}(?:audio|sound|mic|microphone))/iu;

function containsForbiddenVisualBodyRelation(value: string): boolean {
  return FORBIDDEN_VISUAL_BODY_RELATION.test(normalizeText(value));
}

function echoesQuestionInvitation(value: string): boolean {
  const normalized = normalizeFingerprint(value);
  return (
    QUESTION_INVITATION_ECHO_RU.test(normalized) || QUESTION_INVITATION_ECHO_EN.test(normalized)
  );
}

function containsUngroundedVisualQualityClaim(value: string): boolean {
  return UNGROUNDED_VISUAL_QUALITY_CLAIM.test(normalizeText(value));
}

function containsUngroundedAudioQualityClaim(value: string): boolean {
  return UNGROUNDED_AUDIO_QUALITY_CLAIM.test(normalizeText(value));
}

function truncateText(value: string, maximum: number): string {
  return Array.from(normalizeText(value)).slice(0, maximum).join('').trim();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function canonicalizeRawVisualGrounding(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.status === 'none') return { ...EMPTY_VISUAL_GROUNDING };
  if (value.status !== 'uncertain' && value.status !== 'confirmed') return value;
  if (
    typeof value.label !== 'string' ||
    typeof value.transcriptSequence !== 'number' ||
    typeof value.frameSequence !== 'number' ||
    !Number.isInteger(value.transcriptSequence) ||
    !Number.isInteger(value.frameSequence) ||
    value.transcriptSequence <= 0 ||
    value.frameSequence <= 0
  )
    return { ...EMPTY_VISUAL_GROUNDING };
  const label = normalizeText(value.label).split(/\s+/u).slice(0, 4).join(' ');
  return label ? { ...value, label } : { ...EMPTY_VISUAL_GROUNDING };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function prepareSemanticContextCandidate(data: unknown): {
  data: unknown;
  issues: ValidationIssue[];
} {
  if (!isRecord(data)) return { data, issues: [] };
  const rawVisualGrounding = data.visualGrounding;
  const rawLabel = isRecord(rawVisualGrounding) ? rawVisualGrounding.label : undefined;
  const issues =
    typeof rawLabel === 'string' && containsForbiddenVisualBodyRelation(rawLabel)
      ? [issue('visualGrounding.label', 'CONTEXT_DOMAIN_INVALID')]
      : [];
  const canonicalVisualGrounding = canonicalizeRawVisualGrounding(rawVisualGrounding);
  const parsedVisualGrounding = visualGroundingSchema.safeParse(canonicalVisualGrounding);
  const rawAudienceDirection = data.audienceDirection;
  const boundedAudienceDirection = isRecord(rawAudienceDirection)
    ? {
        ...rawAudienceDirection,
        ...(isStringArray(rawAudienceDirection.suggestedTopics)
          ? {
              suggestedTopics: rawAudienceDirection.suggestedTopics
                .slice(0, 6)
                .map((value) => truncateText(value, 80)),
            }
          : {}),
        ...(isStringArray(rawAudienceDirection.keyFacts)
          ? {
              keyFacts: rawAudienceDirection.keyFacts
                .slice(0, 8)
                .map((value) => truncateText(value, 120)),
            }
          : {}),
      }
    : rawAudienceDirection;
  const boundedData = {
    ...data,
    visualGrounding: canonicalVisualGrounding,
    audienceDirection: boundedAudienceDirection,
  };
  if (
    typeof data.topicResetSequence !== 'number' ||
    !Number.isInteger(data.topicResetSequence) ||
    data.topicResetSequence <= 0 ||
    !parsedVisualGrounding.success ||
    parsedVisualGrounding.data.status === 'none'
  )
    return { data: boundedData, issues };

  return {
    data: { ...boundedData, visualGrounding: EMPTY_VISUAL_GROUNDING },
    issues,
  };
}

function containsExactGroundedLabel(value: string, label: string): boolean {
  const needle = normalizeFingerprint(label);
  if (!needle) return false;
  return ` ${normalizeFingerprint(value)} `.includes(` ${needle} `);
}

function words(value: string): Set<string> {
  return new Set(
    normalizeFingerprint(value)
      .split(' ')
      .filter((token) => token.length > 1),
  );
}

export function jaccardSimilarity(left: string, right: string): number {
  const leftWords = words(left);
  const rightWords = words(right);
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  let intersection = 0;
  for (const word of leftWords) if (rightWords.has(word)) intersection += 1;
  return intersection / (leftWords.size + rightWords.size - intersection);
}

export function copiesTranscript(comment: string, transcripts: readonly string[]): boolean {
  const normalized = normalizeFingerprint(comment);
  const commentWords = words(normalized);
  return transcripts.some((transcript) => {
    const candidate = normalizeFingerprint(transcript);
    return (
      (normalized.length >= 16 && candidate.includes(normalized)) ||
      (commentWords.size >= 4 && jaccardSimilarity(normalized, candidate) >= 0.82)
    );
  });
}

function identityWords(value: string): string {
  return ` ${normalizeFingerprint(value)} `;
}

function copiesOwnIdentity(
  text: string,
  persona: CommentGenerationRequest['personas'][number],
): boolean {
  const haystack = identityWords(text);
  return [persona.displayName, persona.username].some((identity) => {
    const needle = normalizeFingerprint(identity);
    return needle.length >= 2 && haystack.includes(` ${needle} `);
  });
}

function matchesLanguage(text: string, language: 'ru' | 'en'): boolean {
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (language === 'ru') return cyrillic > 0 && cyrillic > latin;
  return latin > 0 && latin > cyrillic;
}

function containsEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text);
}

function emojiCount(text: string): number {
  return Array.from(EMOJI_SEGMENTER.segment(text)).filter(({ segment }) => containsEmoji(segment))
    .length;
}

function normalizeCasing(
  text: string,
  casing: CommentSlot['casing'],
  language: CommentSlot['language'],
): string {
  if (casing === 'mixed') return text;
  return text.replace(/\p{L}/u, (letter) =>
    casing === 'sentence' ? letter.toLocaleUpperCase(language) : letter.toLocaleLowerCase(language),
  );
}

function maximumLength(length: CommentSlot['length']): number {
  return COMMENT_LENGTH_LIMITS[length];
}

function normalizeSemanticContext(context: SemanticContext): SemanticContext {
  return {
    sceneSummary: normalizeText(context.sceneSummary),
    conversationSummary: normalizeText(context.conversationSummary),
    topic: normalizeText(context.topic),
    topicResetSequence: context.topicResetSequence,
    hostIntent: context.hostIntent,
    hostTarget: { ...context.hostTarget },
    presenterContext: {
      visibleCount: context.presenterContext.visibleCount,
      participants: context.presenterContext.participants
        .map((participant) => ({
          ...participant,
          label: normalizeText(participant.label),
          visualAnchor: normalizeText(participant.visualAnchor),
        }))
        .sort(
          (left, right) =>
            ['primary', 'guest_1', 'guest_2'].indexOf(left.id) -
            ['primary', 'guest_1', 'guest_2'].indexOf(right.id),
        ),
      event: context.presenterContext.event,
      eventParticipantId: context.presenterContext.eventParticipantId,
      eventCue: normalizeText(context.presenterContext.eventCue),
      complimentTargetId: context.presenterContext.complimentTargetId,
      complimentCue: normalizeText(context.presenterContext.complimentCue),
    },
    visualGrounding: {
      status: context.visualGrounding.status,
      label: normalizeText(context.visualGrounding.label),
      transcriptSequence: context.visualGrounding.transcriptSequence,
      frameSequence: context.visualGrounding.frameSequence,
    },
    audienceDirection: {
      reactToSpeech: context.audienceDirection.reactToSpeech,
      questionShare: context.audienceDirection.questionShare,
      suggestedTopics: context.audienceDirection.suggestedTopics.map(normalizeText),
      keyFacts: context.audienceDirection.keyFacts.map(normalizeText),
    },
  };
}

const GENERIC_PRESENTER_LABELS = {
  guest_1: 'Гость 1',
  guest_2: 'Гость 2',
} as const;

function containsExactNormalizedLabel(text: string, label: string): boolean {
  const haystack = ` ${normalizeFingerprint(text)} `;
  const needle = normalizeFingerprint(label);
  return needle.length >= 2 && haystack.includes(` ${needle} `);
}

function presenterVisualState(
  context: SemanticContext['presenterContext'],
): Array<{ id: string; visible: boolean; visualAnchor: string }> {
  return context.participants.map(({ id, visible, visualAnchor }) => ({
    id,
    visible,
    visualAnchor,
  }));
}

function sameVisualState(
  left: SemanticContext['presenterContext'],
  right: SemanticContext['presenterContext'],
): boolean {
  return JSON.stringify(presenterVisualState(left)) === JSON.stringify(presenterVisualState(right));
}

function canonicalizeVisualGrounding(
  grounding: SemanticContext['visualGrounding'],
  previous: SemanticContext['visualGrounding'],
  request: ContextAnalysisRequest,
  latestNewTranscriptSequence: number | undefined,
  newTranscriptSequences: ReadonlySet<number>,
  topicResetSequence: number,
): SemanticContext['visualGrounding'] {
  if (grounding.status === 'none') return grounding;
  const hasFreshEvidence =
    topicResetSequence === 0 &&
    Boolean(request.frameDataUrl) &&
    latestNewTranscriptSequence !== undefined &&
    grounding.transcriptSequence === latestNewTranscriptSequence &&
    newTranscriptSequences.has(grounding.transcriptSequence) &&
    grounding.frameSequence === request.sequence;
  if (!hasFreshEvidence) return { ...EMPTY_VISUAL_GROUNDING };
  if (grounding.status === 'uncertain') return grounding;

  const hasPriorMatchingObservation =
    previous.status !== 'none' &&
    normalizeFingerprint(previous.label) === normalizeFingerprint(grounding.label) &&
    previous.frameSequence > 0 &&
    previous.frameSequence < grounding.frameSequence;
  return hasPriorMatchingObservation ? grounding : { ...grounding, status: 'uncertain' };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function explicitlyAddressesIdentity(
  transcript: string,
  dialogue: ContextAnalysisRequest['openDialogues'][number],
): boolean {
  const normalized = transcript.normalize('NFKC').toLocaleLowerCase('ru');
  const username = escapeRegExp(dialogue.username.toLocaleLowerCase('en'));
  if (
    new RegExp(`(?:^|[^\\p{L}\\p{N}._])@${username}(?=$|[^\\p{L}\\p{N}._])`, 'u').test(normalized)
  )
    return true;

  const aliases = [dialogue.username, dialogue.displayName]
    .map((value) => value.normalize('NFKC').toLocaleLowerCase('ru').trim())
    .filter((value, index, values) => value.length >= 3 && values.indexOf(value) === index);
  return aliases.some((alias) => {
    const escaped = escapeRegExp(alias);
    return new RegExp(
      `(?:^(?:эй\\s+)?${escaped}\\s*[,!:—-]|(?:слушай|смотри|ответ(?:ь|ил|ила)?|спасибо|для|hey|hi|thanks)\\s+${escaped}(?=$|[\\s,!.?:—-]))`,
      'iu',
    ).test(normalized);
  });
}

function explicitlyAddressedDialogues(
  transcript: string,
  dialogues: ContextAnalysisRequest['openDialogues'],
): ContextAnalysisRequest['openDialogues'] {
  return dialogues.filter(
    (dialogue) =>
      dialogue.status === 'awaiting_host' && explicitlyAddressesIdentity(transcript, dialogue),
  );
}

export function parseAndValidateSemanticContext(
  content: string | null,
  request: ContextAnalysisRequest,
): ContextAnalysisValidation {
  const parsedJson = parseJson(content);
  if (!parsedJson.success) return { context: null, issues: parsedJson.issues };
  const prepared = prepareSemanticContextCandidate(parsedJson.data);
  const parsed = semanticContextSchema.safeParse(prepared.data);
  if (!parsed.success)
    return {
      context: null,
      issues: [
        ...prepared.issues,
        ...parsed.error.issues.map((entry) =>
          issue(
            entry.path.length > 0 ? entry.path.join('.') : 'root',
            entry.path.length > 0 ? 'CONTEXT_SCHEMA_INVALID' : 'ROOT_SCHEMA_INVALID',
          ),
        ),
      ].slice(0, MAX_REPORTED_ISSUES),
    };
  const parsedContext = normalizeSemanticContext(parsed.data);
  const previous = normalizeSemanticContext(request.previousContext);
  const issues: ValidationIssue[] = [...prepared.issues];
  const newTranscriptSequences = new Set(request.newTranscriptSequences);
  const newTranscriptSegments = request.transcriptSegments.filter((segment) =>
    newTranscriptSequences.has(segment.sequence),
  );
  const latestNewSegment = newTranscriptSegments.at(-1);
  const visualGrounding = canonicalizeVisualGrounding(
    parsedContext.visualGrounding,
    previous.visualGrounding,
    request,
    latestNewSegment?.sequence,
    newTranscriptSequences,
    parsedContext.topicResetSequence,
  );
  const normalized: SemanticContext = {
    ...parsedContext,
    sceneSummary: request.frameDataUrl ? parsedContext.sceneSummary : '',
    visualGrounding,
  };
  const newHostUtterance = newTranscriptSegments.map(({ text }) => text).join(' ');
  const explicitTargets = latestNewSegment
    ? explicitlyAddressedDialogues(newHostUtterance, request.openDialogues)
    : [];
  if (
    normalized.topicResetSequence !== 0 &&
    (normalized.topicResetSequence !== latestNewSegment?.sequence ||
      !newTranscriptSequences.has(normalized.topicResetSequence))
  )
    issues.push(issue('topicResetSequence', 'CONTEXT_DOMAIN_INVALID'));
  if (normalized.topicResetSequence !== 0 && visualGrounding.status !== 'none')
    issues.push(issue('visualGrounding', 'CONTEXT_DOMAIN_INVALID'));
  const semanticVisualRelationFields: Array<[string, string]> = [
    ['sceneSummary', normalized.sceneSummary],
    ['conversationSummary', normalized.conversationSummary],
    ['topic', normalized.topic],
    ...normalized.audienceDirection.keyFacts.map((fact, index): [string, string] => [
      `audienceDirection.keyFacts.${index}`,
      fact,
    ]),
  ];
  for (const [path, value] of semanticVisualRelationFields)
    if (containsForbiddenVisualBodyRelation(value))
      issues.push(issue(path, 'CONTEXT_DOMAIN_INVALID'));
  const semanticAudioClaimFields: Array<[string, string]> = [
    ['sceneSummary', normalized.sceneSummary],
    ['conversationSummary', normalized.conversationSummary],
    ['topic', normalized.topic],
    ['visualGrounding.label', normalized.visualGrounding.label],
    ['presenterContext.eventCue', normalized.presenterContext.eventCue],
    ['presenterContext.complimentCue', normalized.presenterContext.complimentCue],
    ...normalized.presenterContext.participants.map((participant, index): [string, string] => [
      `presenterContext.participants.${index}.visualAnchor`,
      participant.visualAnchor,
    ]),
    ...normalized.audienceDirection.suggestedTopics.map((topic, index): [string, string] => [
      `audienceDirection.suggestedTopics.${index}`,
      topic,
    ]),
    ...normalized.audienceDirection.keyFacts.map((fact, index): [string, string] => [
      `audienceDirection.keyFacts.${index}`,
      fact,
    ]),
  ];
  for (const [path, value] of semanticAudioClaimFields)
    if (containsUngroundedAudioQualityClaim(value))
      issues.push(issue(path, 'AUDIO_CLAIM_NOT_GROUNDED'));
  if (
    normalized.audienceDirection.reactToSpeech &&
    (!request.transcriptChanged || newTranscriptSequences.size === 0)
  )
    issues.push(issue('audienceDirection.reactToSpeech', 'CONTEXT_DOMAIN_INVALID'));
  const presenter = normalized.presenterContext;
  const previousPresenter = previous.presenterContext;
  const primary = presenter.participants.find(({ id }) => id === 'primary');
  if (
    primary?.label !== normalizeText(request.host.displayName) ||
    primary?.labelSource !== 'configured'
  )
    issues.push(issue('presenterContext.participants', 'CONTEXT_DOMAIN_INVALID'));

  const transcriptForLabels = newTranscriptSegments.map(({ text }) => text).join(' ');
  for (const participant of presenter.participants) {
    if (participant.id !== 'primary' && participant.labelSource === 'configured')
      issues.push(issue('presenterContext.participants', 'CONTEXT_DOMAIN_INVALID'));
    if (
      participant.id !== 'primary' &&
      participant.labelSource === 'generic' &&
      participant.label !== GENERIC_PRESENTER_LABELS[participant.id]
    )
      issues.push(issue('presenterContext.participants', 'CONTEXT_DOMAIN_INVALID'));
    if (participant.labelSource === 'spoken') {
      const prior = previousPresenter.participants.find(({ id }) => id === participant.id);
      const preserved = prior?.labelSource === 'spoken' && prior.label === participant.label;
      if (!preserved && !containsExactNormalizedLabel(transcriptForLabels, participant.label))
        issues.push(issue('presenterContext.participants', 'CONTEXT_DOMAIN_INVALID'));
    }
  }

  const previousHasObservation =
    previousPresenter.visibleCount > 0 ||
    previousPresenter.participants.some(({ visualAnchor }) => Boolean(visualAnchor));
  const eventParticipant = presenter.participants.find(
    ({ id }) => id === presenter.eventParticipantId,
  );
  const previousEventParticipant = previousPresenter.participants.find(
    ({ id }) => id === presenter.eventParticipantId,
  );
  if (presenter.event !== 'none') {
    const transitionIsValid =
      presenter.event === 'joined'
        ? Boolean(eventParticipant?.visible && !previousEventParticipant)
        : presenter.event === 'returned'
          ? Boolean(eventParticipant?.visible && previousEventParticipant?.visible === false)
          : presenter.event === 'left'
            ? Boolean(
                eventParticipant && !eventParticipant.visible && previousEventParticipant?.visible,
              )
            : Boolean(
                eventParticipant?.visible &&
                (!previousEventParticipant ||
                  !previousEventParticipant.visible ||
                  previousEventParticipant.visualAnchor !== eventParticipant.visualAnchor),
              );
    if (
      !request.frameDataUrl ||
      !request.sceneChanged ||
      !previousHasObservation ||
      !transitionIsValid
    )
      issues.push(issue('presenterContext.event', 'CONTEXT_DOMAIN_INVALID'));
  }
  if (!request.frameDataUrl && !sameVisualState(presenter, previousPresenter))
    issues.push(issue('presenterContext.participants', 'CONTEXT_DOMAIN_INVALID'));
  if (
    request.frameDataUrl &&
    previousHasObservation &&
    !request.sceneChanged &&
    !sameVisualState(presenter, previousPresenter)
  )
    issues.push(issue('presenterContext.participants', 'CONTEXT_DOMAIN_INVALID'));
  if (presenter.complimentTargetId !== 'none') {
    const target = presenter.participants.find(({ id }) => id === presenter.complimentTargetId);
    if (!request.frameDataUrl || !target?.visible)
      issues.push(issue('presenterContext.complimentCue', 'CONTEXT_DOMAIN_INVALID'));
  }
  if (
    normalized.hostIntent === 'request_topics' &&
    normalized.audienceDirection.suggestedTopics.length === 0
  )
    issues.push(issue('audienceDirection.suggestedTopics', 'CONTEXT_DOMAIN_INVALID'));
  if (
    [
      ...normalized.audienceDirection.suggestedTopics,
      ...normalized.audienceDirection.keyFacts,
    ].some((value) => !value)
  )
    issues.push(issue('audienceDirection', 'CONTEXT_DOMAIN_INVALID'));
  if (normalized.hostTarget.type === 'viewer') {
    const dialogue = request.openDialogues.find(
      (candidate) =>
        candidate.dialogueId === normalized.hostTarget.dialogueId &&
        candidate.personaId === normalized.hostTarget.personaId &&
        candidate.status === 'awaiting_host',
    );
    const latestViewerTurn = dialogue?.turns.findLast((turn) => turn.role === 'viewer');
    if (
      !request.transcriptChanged ||
      !newTranscriptSequences.has(normalized.hostTarget.transcriptSequence) ||
      !dialogue ||
      latestViewerTurn?.turnId !== normalized.hostTarget.turnId ||
      (normalized.hostIntent !== 'answer' && normalized.hostIntent !== 'question')
    )
      issues.push(issue('hostTarget', 'CONTEXT_DOMAIN_INVALID'));
  }
  if (
    explicitTargets.length === 1 &&
    (normalized.hostTarget.type !== 'viewer' ||
      normalized.hostTarget.dialogueId !== explicitTargets[0]?.dialogueId ||
      normalized.hostTarget.personaId !== explicitTargets[0]?.personaId ||
      normalized.hostTarget.turnId !==
        explicitTargets[0]?.turns.findLast((turn) => turn.role === 'viewer')?.turnId ||
      normalized.hostTarget.transcriptSequence !== latestNewSegment?.sequence)
  )
    issues.push(issue('hostTarget', 'CONTEXT_DOMAIN_INVALID'));
  if (explicitTargets.length > 1 && normalized.hostTarget.type === 'viewer')
    issues.push(issue('hostTarget', 'CONTEXT_DOMAIN_INVALID'));
  if (
    normalized.hostTarget.type === 'audience' &&
    ((normalized.hostIntent !== 'question' && normalized.hostIntent !== 'request_questions') ||
      !newTranscriptSequences.has(normalized.hostTarget.transcriptSequence))
  )
    issues.push(issue('hostTarget', 'CONTEXT_DOMAIN_INVALID'));
  if (normalized.hostIntent === 'request_questions' && normalized.hostTarget.type !== 'audience')
    issues.push(issue('hostTarget', 'CONTEXT_DOMAIN_INVALID'));
  return issues.length > 0 ? { context: null, issues } : { context: normalized, issues: [] };
}

export function missingCommentSlots(
  request: CommentGenerationRequest,
  validation: Pick<GeneratedBatchValidation, 'acceptedSlotIds'>,
): CommentSlot[] {
  const accepted = new Set(validation.acceptedSlotIds);
  return request.slots.filter((slot) => !accepted.has(slot.slotId));
}

export function parseAndValidateGeneratedBatch(
  content: string | null,
  request: CommentGenerationRequest,
  existingOutputs: readonly GeneratedCommentOutput[] = [],
): GeneratedBatchValidation {
  const parsedJson = parseJson(content);
  if (!parsedJson.success)
    return {
      comments: [],
      acceptedOutputs: [],
      acceptedSlotIds: [],
      receivedItems: 0,
      invalidItems: 0,
      issues: parsedJson.issues,
    };

  if (
    typeof parsedJson.data !== 'object' ||
    parsedJson.data === null ||
    Array.isArray(parsedJson.data) ||
    Object.keys(parsedJson.data).some((key) => key !== 'comments') ||
    !Array.isArray((parsedJson.data as { comments?: unknown }).comments)
  )
    return {
      comments: [],
      acceptedOutputs: [],
      acceptedSlotIds: [],
      receivedItems: 0,
      invalidItems: 0,
      issues: [issue('root', 'ROOT_SCHEMA_INVALID')],
    };

  const rawComments = (parsedJson.data as { comments: unknown[] }).comments;
  const slotById = new Map(request.slots.map((slot) => [slot.slotId, slot]));
  const personaById = new Map(request.personas.map((persona) => [persona.id, persona]));
  const transcripts = request.transcriptSegments.map((segment) => segment.text);
  const comparisonPool = [
    ...request.recentComments.map((comment) => comment.text),
    ...request.noveltyTexts,
    ...existingOutputs.map((comment) => comment.text),
  ];
  const exact = new Set(comparisonPool.map(normalizeFingerprint));
  const seenSlots = new Set(existingOutputs.map((comment) => comment.slotId));
  const acceptedOutputs: GeneratedCommentOutput[] = [];
  const comments: GeneratedAudienceComment[] = [];
  const issues: ValidationIssue[] = [];
  if (rawComments.length > 24) issues.push(issue('comments', 'BATCH_EXCEEDS_LIMIT'));

  for (const [index, rawComment] of rawComments.slice(0, 24).entries()) {
    const parsed = generatedCommentOutputSchema.safeParse(rawComment);
    if (!parsed.success) {
      for (const entry of parsed.error.issues)
        issues.push(
          issue(
            `comments.${index}${entry.path.length > 0 ? `.${entry.path.join('.')}` : ''}`,
            'COMMENT_SCHEMA_INVALID',
          ),
        );
      continue;
    }

    const candidate = parsed.data;
    const slot = slotById.get(candidate.slotId);
    if (!slot) {
      issues.push(issue(`comments.${index}.slotId`, 'SLOT_UNKNOWN'));
      continue;
    }
    const persona = personaById.get(slot.personaId);
    if (!persona) {
      issues.push(issue(`comments.${index}.slotId`, 'PERSONA_UNKNOWN'));
      continue;
    }
    const text = normalizeCasing(normalizeText(candidate.text), slot.casing, slot.language);
    const fingerprint = normalizeFingerprint(text);
    let candidateIssue: ValidationIssue | null = null;
    if (seenSlots.has(candidate.slotId))
      candidateIssue = issue(`comments.${index}.slotId`, 'SLOT_DUPLICATE');
    else if (!text) candidateIssue = issue(`comments.${index}.text`, 'COMMENT_EMPTY');
    else if (Array.from(text).length > maximumLength(slot.length))
      candidateIssue = issue(`comments.${index}.text`, 'COMMENT_TOO_LONG');
    else if (copiesOwnIdentity(text, persona))
      candidateIssue = issue(`comments.${index}.text`, 'SELF_IDENTITY_COPY');
    else if (!matchesLanguage(text, slot.language))
      candidateIssue = issue(`comments.${index}.text`, 'LANGUAGE_MISMATCH');
    else if (
      request.semanticContext.hostIntent === 'request_questions' &&
      echoesQuestionInvitation(text)
    )
      candidateIssue = issue(`comments.${index}.text`, 'QUESTION_INVITATION_ECHO');
    else if (containsUngroundedAudioQualityClaim(text))
      candidateIssue = issue(`comments.${index}.text`, 'AUDIO_CLAIM_NOT_GROUNDED');
    else if (!slot.allowEmoji && containsEmoji(text))
      candidateIssue = issue(`comments.${index}.text`, 'EMOJI_NOT_ALLOWED');
    else if (emojiCount(text) > 1) candidateIssue = issue(`comments.${index}.text`, 'EMOJI_EXCESS');
    else if (containsForbiddenVisualBodyRelation(text))
      candidateIssue = issue(`comments.${index}.text`, 'VISUAL_BODY_RELATION');
    else if (!slot.allowVisualClaim && containsUngroundedVisualQualityClaim(text))
      candidateIssue = issue(`comments.${index}.text`, 'VISUAL_CLAIM_NOT_ALLOWED');
    else if (
      request.semanticContext.visualGrounding.status !== 'none' &&
      !slot.allowVisualClaim &&
      containsExactGroundedLabel(text, request.semanticContext.visualGrounding.label)
    )
      candidateIssue = issue(`comments.${index}.text`, 'VISUAL_CLAIM_NOT_ALLOWED');
    else if (
      request.semanticContext.visualGrounding.status === 'uncertain' &&
      slot.allowVisualClaim &&
      !UNCERTAIN_VISUAL_LANGUAGE.test(text)
    )
      candidateIssue = issue(`comments.${index}.text`, 'VISUAL_CLAIM_UNCERTAIN');
    else if (exact.has(fingerprint))
      candidateIssue = issue(`comments.${index}.text`, 'DUPLICATE_EXACT');
    else if (
      [...comparisonPool, ...acceptedOutputs.map((comment) => comment.text)].some(
        (existing) => jaccardSimilarity(existing, text) >= 0.82,
      )
    )
      candidateIssue = issue(`comments.${index}.text`, 'DUPLICATE_FUZZY');
    else if (copiesTranscript(text, transcripts))
      candidateIssue = issue(`comments.${index}.text`, 'TRANSCRIPT_COPY');

    if (candidateIssue) {
      issues.push(candidateIssue);
      continue;
    }

    seenSlots.add(candidate.slotId);
    exact.add(fingerprint);
    const acceptedOutput = { slotId: candidate.slotId, text };
    acceptedOutputs.push(acceptedOutput);
    comments.push({
      slotId: slot.slotId,
      personaId: slot.personaId,
      text,
      language: slot.language,
      kind: slot.kind,
      ...(slot.dialogueId ? { dialogueId: slot.dialogueId } : {}),
      ...(slot.dialogueAction ? { dialogueAction: slot.dialogueAction } : {}),
      ...(slot.replyTarget ? { replyTarget: slot.replyTarget } : {}),
    });
  }

  for (const slot of request.slots)
    if (!seenSlots.has(slot.slotId)) issues.push(issue(`slots.${slot.slotId}`, 'SLOT_MISSING'));

  return {
    comments,
    acceptedOutputs,
    acceptedSlotIds: acceptedOutputs.map((comment) => comment.slotId),
    receivedItems: rawComments.length,
    invalidItems: Math.max(0, rawComments.length - acceptedOutputs.length),
    issues: issues.slice(0, MAX_REPORTED_ISSUES),
  };
}

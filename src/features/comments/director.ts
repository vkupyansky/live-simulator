import {
  EMPTY_SEMANTIC_CONTEXT,
  type CommentKind,
  type CommentLength,
  type CommentSlot,
  type DialogueAction,
  type DialogueReplyTarget,
  type OpenDialogueContext,
  type PersonaMemoryContext,
  type SemanticContext,
} from '@/features/ai/contracts';
import { calculateActivePoolSize } from '@/features/audience/model';
import { BEHAVIOR_CALIBRATION, interpolate, smoothLoad } from '@/features/comments/behavior';
import { DialogueCoordinator, type OpenDialogueStateContext } from '@/features/comments/dialogue';
import { analyzeHostUtterance } from '@/features/comments/hostUtterance';
import type { GeneratedAudienceComment } from '@/features/comments/scheduler';
import { createPrng, type Prng } from '@/features/viewers/prng';
import type { AudiencePersona, TranscriptSegment } from '@/shared/types/broadcast';

const MAX_PERSONA_MESSAGES = 6;
const MAX_NOVELTY_TEXTS = 300;

interface PersonaMemory {
  recentMessages: string[];
  participationCount: number;
}

interface ViewerDialogueState {
  dialogueId: string;
  participantIds: string[];
  language: 'ru' | 'en';
  recentMessages: Array<{ turnId: string; personaId: string; text: string }>;
  remainingTurns: number;
  expiresAt: number;
}

interface PlannedViewerDialogueSlot {
  dialogueId: string;
  persona: AudiencePersona;
  action: Extract<DialogueAction, 'start_viewer' | 'reply_viewer'>;
  replyTarget?: Extract<DialogueReplyTarget, { type: 'viewer' }>;
}

interface HostSlotPlan {
  persona: AudiencePersona;
  dialogueId: string;
  action: Extract<DialogueAction, 'answer_host' | 'acknowledge_host' | 'follow_up_host'>;
  replyTarget: Extract<DialogueReplyTarget, { type: 'host' }>;
  instruction: string;
  allowVisualClaim: boolean;
  hostTurn: { transcriptSequence: number; text: string };
  audienceSequence?: number;
  allowReplacement?: boolean;
}

interface PendingPlan {
  newDialogue: ViewerDialogueState | null;
  newSourceSlotId: string | null;
  newReplySlotId: string | null;
  continuingDialogueId: string | null;
  continuingSlotId: string | null;
  presenterEventRevision: number | null;
  presenterEventSlotIds: string[];
}

interface PresenterEventSlotPlan {
  kind: Extract<CommentKind, 'question' | 'observation' | 'greeting' | 'reaction'>;
  instruction: string;
}

interface AcceptedDialogueStart {
  dialogue: ViewerDialogueState;
  expiresAt: number;
}

interface AcceptedViewerReply {
  dialogueId: string;
  expiresAt: number;
}

export interface DirectorPlanInput {
  sequence: number;
  desiredBatchSize: number;
  currentViewers: number;
  commentsPerMinute: number;
  transcriptSegments: readonly TranscriptSegment[];
  newTranscriptSequences: readonly number[];
  transcriptChanged: boolean;
  semanticContext: SemanticContext;
  semanticContextRevision?: number;
  now: number;
}

export interface DirectorPlan {
  personas: AudiencePersona[];
  slots: CommentSlot[];
  memories: PersonaMemoryContext[];
  noveltyTexts: string[];
  semanticContext: SemanticContext;
  openDialogues: OpenDialogueContext[];
}

function weightedPick(
  candidates: readonly AudiencePersona[],
  random: Prng,
  memories: ReadonlyMap<string, PersonaMemory>,
  eligible?: (persona: AudiencePersona) => boolean,
): AudiencePersona | null {
  let totalWeight = 0;
  for (const persona of candidates) {
    if (eligible && !eligible(persona)) continue;
    const participation = memories.get(persona.id)?.participationCount ?? 0;
    totalWeight += persona.style.activityWeight / (1 + participation * 0.1);
  }
  if (totalWeight <= 0) return null;
  let cursor = random.next() * totalWeight;
  let lastEligible: AudiencePersona | null = null;
  for (const persona of candidates) {
    if (eligible && !eligible(persona)) continue;
    lastEligible = persona;
    const participation = memories.get(persona.id)?.participationCount ?? 0;
    cursor -= persona.style.activityWeight / (1 + participation * 0.1);
    if (cursor <= 0) return persona;
  }
  return lastEligible;
}

function chooseLength(random: Prng, load: number): CommentLength {
  const longShare = interpolate(
    BEHAVIOR_CALIBRATION.style.longShare.conversational,
    BEHAVIOR_CALIBRATION.style.longShare.overloaded,
    load,
  );
  const shortShare = interpolate(
    BEHAVIOR_CALIBRATION.style.shortShare.conversational,
    BEHAVIOR_CALIBRATION.style.shortShare.overloaded,
    load,
  );
  const roll = random.next();
  if (roll < shortShare) return 'short';
  if (roll < 1 - longShare) return 'medium';
  return 'long';
}

function instructionFor(
  kind: CommentKind,
  context: SemanticContext,
  transcriptChanged: boolean,
  proposeTopic: boolean,
  topicReset: boolean,
  dialogueAction?: DialogueAction,
): string {
  if (dialogueAction === 'answer_host')
    return 'Ответь на последнюю реплику ведущего прямо, от первого лица и на языке этого зрителя. Не задавай встречный вопрос.';
  if (dialogueAction === 'follow_up_host')
    return 'Сначала естественно отреагируй на ответ ведущего, затем задай один короткий связанный уточняющий вопрос. Сохрани язык и характер этого же зрителя.';
  if (dialogueAction === 'acknowledge_host')
    return 'Коротко и по смыслу отреагируй на ответ ведущего от лица того же зрителя. Не задавай новый вопрос.';
  if (proposeTopic)
    return 'Сам предложи одну конкретную тему для разговора. Не спрашивай ведущего, что он выбрал или предложит.';
  if (topicReset)
    return 'Коротко и естественно согласись сменить тему. Не упоминай прежнюю тему, предметы или детали прошлого кадра.';
  if (context.hostIntent === 'request_topics' && kind !== 'viewer_reply')
    return 'Коротко поддержи разговор без новой темы и без встречного вопроса ведущему.';
  switch (kind) {
    case 'speech_reaction':
      return 'Отреагируй на последнюю мысль ведущего по смыслу, не копируя его слова.';
    case 'question':
      return 'Задай короткий уместный вопрос по текущей теме, без допроса.';
    case 'observation':
      return context.presenterContext.complimentCue
        ? `Можно сделать небольшой уважительный комплимент только по этой подсказке: ${context.presenterContext.complimentCue}`
        : 'Коротко отреагируй только на текущую тему разговора, без утверждений о кадре.';
    case 'viewer_reply':
      return 'Ответь другому зрителю по смыслу и кратко, не переключаясь на ведущего.';
    case 'greeting':
      return 'Поздоровайся естественно, без представления своим именем.';
    case 'reaction':
      return transcriptChanged
        ? 'Передай живую короткую реакцию на последнюю реплику ведущего.'
        : 'Передай живую короткую реакцию на текущий разговор, без утверждений о кадре.';
    case 'casual':
      return 'Напиши обычную реплику живого зрителя по контексту, без общих шаблонов.';
  }
}

function visualGroundingMatches(context: SemanticContext, transcriptSequence: number): boolean {
  return (
    context.visualGrounding.status !== 'none' &&
    context.visualGrounding.transcriptSequence === transcriptSequence
  );
}

function visualAnswerInstruction(context: SemanticContext): string {
  if (context.visualGrounding.status === 'confirmed')
    return `Ответь на визуальный вопрос прямо и коротко. Разрешено назвать только подтверждённый предмет «${context.visualGrounding.label}». Не придумывай марку, положение относительно тела или другие детали.`;
  return `Ответь осторожно: «похоже на ${context.visualGrounding.label}, но могу ошибаться» или близко по смыслу. Используй только этот общий вариант предмета как предположение. Не утверждай уверенно, не придумывай марку, положение относительно тела или другие детали.`;
}

const INVITED_QUESTION_ANGLES = [
  'личном выборе и его последствиях',
  'работе, учёбе или любимом деле',
  'отношениях и дружбе',
  'целях и планах',
  'важном жизненном опыте',
  'привычках и повседневной жизни',
] as const;

function invitedQuestionInstruction(angle: string): string {
  return `Задай конкретный вопрос ведущему о ${angle}. Не повторяй просьбу и не пиши «вопросы по жизни», «какие вопросы», «что спросить» или «какой вопрос выбрать».`;
}

const GENERIC_PRESENTER_LABELS = new Set([
  'ведущий',
  'ведущая',
  'гость',
  'гостья',
  'человек',
  'участник',
  'участница',
  'host',
  'guest',
]);

function trustedPresenterLabel(
  participant: SemanticContext['presenterContext']['participants'][number] | undefined,
): string | null {
  if (!participant || participant.labelSource === 'generic') return null;
  const label = participant.label.normalize('NFKC').trim();
  return label && !GENERIC_PRESENTER_LABELS.has(label.toLocaleLowerCase('ru')) ? label : null;
}

function presenterEventPlans(
  context: SemanticContext,
  random: Prng,
  maximum: number,
): PresenterEventSlotPlan[] {
  if (maximum <= 0 || context.presenterContext.event === 'none') return [];
  const participant = context.presenterContext.participants.find(
    ({ id }) => id === context.presenterContext.eventParticipantId,
  );
  const label = trustedPresenterLabel(participant);
  const addressed = label ? `участнику ${label}` : 'новому человеку в кадре';
  const plans: PresenterEventSlotPlan[] = [];
  switch (context.presenterContext.event) {
    case 'joined':
    case 'replaced':
      plans.push({
        kind: 'question',
        instruction: label
          ? `Подтверждена смена людей в кадре, и имя ${label} уже известно. Естественно поприветствуй ${addressed} или задай ему один простой вопрос по текущему разговору. Не спрашивай повторно, кто он, и не приписывай ему никаких признаков.`
          : 'Подтверждена смена людей в кадре. Естественно спроси, кто новый человек или как к нему обращаться. Не придумывай имя и признаки.',
      });
      if (maximum > 1 && random.next() < 0.6)
        plans.push({
          kind: random.next() < 0.5 ? 'greeting' : 'observation',
          instruction: label
            ? `Коротко и естественно поприветствуй ${addressed}. Не делай догадок о личности или внешности.`
            : 'Коротко и естественно поприветствуй нового человека в кадре, не выдумывая имя или признаки.',
        });
      break;
    case 'returned':
      plans.push({
        kind: random.next() < 0.5 ? 'greeting' : 'question',
        instruction: label
          ? `Коротко поприветствуй вернувшегося участника ${label} или задай ему один уместный вопрос.`
          : 'Коротко поприветствуй вернувшегося человека или спроси, вернулся ли прежний ведущий. Не придумывай имя.',
      });
      break;
    case 'left':
      plans.push({
        kind: random.next() < 0.5 ? 'question' : 'reaction',
        instruction: label
          ? `Коротко и нейтрально спроси, куда ушёл участник ${label}, либо отреагируй на его уход.`
          : 'Коротко и нейтрально спроси, куда ушёл человек из кадра, либо отреагируй на его уход. Не придумывай имя.',
      });
      break;
  }
  return plans.slice(0, Math.min(2, maximum));
}

function ongoingPresenterInstruction(
  context: SemanticContext,
  kind: Extract<CommentKind, 'question' | 'observation'>,
  random: Prng,
): string {
  const visible = context.presenterContext.participants.filter(({ visible }) => visible);
  const labelled = visible.flatMap((participant) => {
    const label = trustedPresenterLabel(participant);
    return label ? [label] : [];
  });
  const target = labelled.length > 0 ? labelled[random.integer(0, labelled.length - 1)] : undefined;
  if (target)
    return kind === 'question'
      ? `Задай один естественный вопрос видимому участнику ${target}. Не приписывай ему личность, возраст или другие признаки.`
      : `Коротко и нейтрально отреагируй на действие видимого участника ${target}, только если оно подтверждено контекстом.`;
  return kind === 'question'
    ? 'Задай один естественный вопрос всем людям, которые сейчас видны в кадре, не различая их по выдуманным признакам.'
    : 'Коротко и нейтрально отреагируй на людей в кадре как на группу, без догадок об их личности.';
}

function latestViewerTurn(dialogue: OpenDialogueContext) {
  return [...dialogue.turns].reverse().find((turn) => turn.role === 'viewer');
}

function sanitizeDialogueIdentity(
  persona: AudiencePersona,
): Pick<OpenDialogueContext, 'displayName' | 'username'> | null {
  const displayName = persona.displayName
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const username = persona.username.normalize('NFKC').trim();
  if (
    displayName.length === 0 ||
    [...displayName].length > 30 ||
    !/^[A-Za-z0-9._]{3,24}$/u.test(username)
  )
    return null;
  return { displayName, username };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function explicitlyAddressesIdentity(
  transcript: string,
  identity: Pick<OpenDialogueContext, 'displayName' | 'username'>,
): boolean {
  const normalized = transcript.normalize('NFKC').toLocaleLowerCase('ru');
  const username = escapeRegExp(identity.username.toLocaleLowerCase('en'));
  if (
    new RegExp(`(?:^|[^\\p{L}\\p{N}._])@${username}(?=$|[^\\p{L}\\p{N}._])`, 'u').test(normalized)
  )
    return true;

  const aliases = [identity.username, identity.displayName]
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

function explicitlyAddressedDialogue(
  transcript: string,
  dialogues: readonly OpenDialogueContext[],
): OpenDialogueContext | null {
  const matches = dialogues.filter(
    (dialogue) =>
      dialogue.status === 'awaiting_host' &&
      Boolean(latestViewerTurn(dialogue)) &&
      explicitlyAddressesIdentity(transcript, dialogue),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export class ConversationDirector {
  private readonly rosterById: ReadonlyMap<string, AudiencePersona>;
  private readonly memories = new Map<string, PersonaMemory>();
  private readonly viewerDialogues = new Map<string, ViewerDialogueState>();
  private readonly pendingPlans = new Map<number, PendingPlan>();
  private readonly acceptedDialogueStarts = new Map<string, AcceptedDialogueStart>();
  private readonly acceptedViewerReplies = new Map<string, AcceptedViewerReply>();
  private readonly reservedViewerDialogues = new Map<string, number>();
  private readonly hostDialogues: DialogueCoordinator;
  private noveltyTexts: string[] = [];
  private recentAuthorIds: string[] = [];
  private renderedMessageCount = 0;
  private lastComplimentAt = -BEHAVIOR_CALIBRATION.compliments.cooldownMessages;
  private activePoolTarget = 0;
  private lastHandledPresenterRevision = 0;
  private lastTopicResetSequence = 0;

  constructor(
    private readonly seed: string | number,
    private readonly roster: AudiencePersona[],
  ) {
    const rosterById = new Map<string, AudiencePersona>();
    for (const persona of roster) rosterById.set(persona.id, persona);
    this.rosterById = rosterById;
    this.hostDialogues = new DialogueCoordinator({
      maximumActive: BEHAVIOR_CALIBRATION.hostDialogues.maximumActive,
      maximumTurns: BEHAVIOR_CALIBRATION.hostDialogues.maximumTurns,
      lifetimeMs: BEHAVIOR_CALIBRATION.hostDialogues.lifetimeMs,
    });
  }

  plan(input: DirectorPlanInput): DirectorPlan {
    this.pruneViewerDialogues(input.now);
    const random = createPrng(`${this.seed}:${input.sequence}:director`);
    const load = smoothLoad(input.commentsPerMinute);
    const activeRoster = this.selectActivePool(input.currentViewers, input.now);
    const newTranscriptSequenceSet = new Set(input.newTranscriptSequences);
    const newTranscriptSegments = input.transcriptSegments.filter((segment) =>
      newTranscriptSequenceSet.has(segment.sequence),
    );
    const currentUtteranceEnd = newTranscriptSegments.at(-1);
    const currentUtterance = newTranscriptSegments.map(({ text }) => text).join(' ');
    const utteranceAnalysis = analyzeHostUtterance(currentUtterance);
    const topicReset = Boolean(
      input.transcriptChanged &&
      currentUtteranceEnd &&
      (utteranceAnalysis.resetsTopic ||
        input.semanticContext.topicResetSequence === currentUtteranceEnd.sequence),
    );
    if (topicReset && currentUtteranceEnd) this.resetTopic(currentUtteranceEnd.sequence);
    const openHostDialogues = this.getOpenDialogues(input.now);
    const explicitDialogue =
      input.transcriptChanged && currentUtteranceEnd && !topicReset
        ? explicitlyAddressedDialogue(currentUtterance, openHostDialogues)
        : null;
    const explicitRequest =
      input.transcriptChanged && currentUtteranceEnd ? utteranceAnalysis.explicitRequest : null;
    const locallyBroadQuestion = Boolean(
      input.transcriptChanged &&
      currentUtteranceEnd &&
      (utteranceAnalysis.broadAudienceQuestion || utteranceAnalysis.referencesCurrentFrame),
    );
    let semanticContext: SemanticContext = input.semanticContext;
    const explicitViewerTurn = explicitDialogue ? latestViewerTurn(explicitDialogue) : undefined;
    if (topicReset && currentUtteranceEnd)
      semanticContext = {
        ...semanticContext,
        sceneSummary: '',
        conversationSummary: '',
        topic: '',
        topicResetSequence: currentUtteranceEnd.sequence,
        hostIntent: 'request_topics',
        hostTarget: {
          type: 'none',
          transcriptSequence: 0,
          dialogueId: '',
          turnId: '',
          personaId: '',
        },
        presenterContext: {
          ...semanticContext.presenterContext,
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
          ...semanticContext.audienceDirection,
          reactToSpeech: true,
          keyFacts: [],
        },
      };
    else if (explicitDialogue && explicitViewerTurn && currentUtteranceEnd)
      semanticContext = {
        ...semanticContext,
        hostIntent: semanticContext.hostIntent === 'question' ? 'question' : 'answer',
        hostTarget: {
          type: 'viewer',
          transcriptSequence: currentUtteranceEnd.sequence,
          dialogueId: explicitDialogue.dialogueId,
          turnId: explicitViewerTurn.turnId,
          personaId: explicitDialogue.personaId,
        },
      };
    else if (explicitRequest && semanticContext.hostTarget.type !== 'viewer')
      semanticContext = {
        ...semanticContext,
        hostIntent: explicitRequest,
        hostTarget: {
          type: explicitRequest === 'request_questions' ? 'audience' : 'none',
          transcriptSequence:
            explicitRequest === 'request_questions' ? (currentUtteranceEnd?.sequence ?? 0) : 0,
          dialogueId: '',
          turnId: '',
          personaId: '',
        },
      };
    else if (
      locallyBroadQuestion &&
      semanticContext.hostIntent !== 'question' &&
      semanticContext.hostTarget.type !== 'viewer'
    )
      semanticContext = {
        ...semanticContext,
        hostIntent: 'question',
        hostTarget: {
          type: 'audience',
          transcriptSequence: currentUtteranceEnd?.sequence ?? 0,
          dialogueId: '',
          turnId: '',
          personaId: '',
        },
      };
    else if (
      semanticContext.hostIntent === 'request_questions' ||
      semanticContext.hostIntent === 'request_topics'
    )
      semanticContext = {
        ...semanticContext,
        conversationSummary: '',
        topic: '',
        hostIntent: 'ambient',
        hostTarget: { ...EMPTY_SEMANTIC_CONTEXT.hostTarget },
        audienceDirection: {
          ...semanticContext.audienceDirection,
          reactToSpeech: false,
          suggestedTopics: [],
          keyFacts: [],
        },
      };

    const desiredBatchSize = Math.max(1, Math.min(24, input.desiredBatchSize));
    const hostAskedForQuestions = semanticContext.hostIntent === 'request_questions';
    const hostAskedForTopics = semanticContext.hostIntent === 'request_topics';
    let remainingTopicProposals = hostAskedForTopics
      ? topicReset
        ? Math.min(desiredBatchSize, random.integer(2, 3))
        : Math.min(2, Math.max(1, Math.round(desiredBatchSize * 0.25)))
      : 0;
    const questionShare = hostAskedForQuestions
      ? BEHAVIOR_CALIBRATION.style.questionShare.invited
      : Math.min(
          0.12,
          Math.max(
            BEHAVIOR_CALIBRATION.style.questionShare.baseline,
            semanticContext.audienceDirection.questionShare,
          ),
        );
    const questionCount = hostAskedForTopics
      ? 0
      : hostAskedForQuestions
        ? Math.min(
            desiredBatchSize,
            BEHAVIOR_CALIBRATION.hostDialogues.invitedQuestionCount[1],
            Math.max(
              BEHAVIOR_CALIBRATION.hostDialogues.invitedQuestionCount[0],
              Math.round(desiredBatchSize * questionShare),
            ),
          )
        : Math.min(desiredBatchSize - 1, Math.round(desiredBatchSize * questionShare));
    const speechReactionCount = input.transcriptChanged
      ? Math.min(
          desiredBatchSize - questionCount,
          Math.max(
            1,
            Math.round(desiredBatchSize * (semanticContext.hostIntent === 'question' ? 0.45 : 0.3)),
          ),
        )
      : 0;
    const complimentEligible =
      this.renderedMessageCount - this.lastComplimentAt >=
      BEHAVIOR_CALIBRATION.compliments.cooldownMessages;
    const complimentIndex =
      !topicReset &&
      !hostAskedForQuestions &&
      semanticContext.presenterContext.complimentCue &&
      complimentEligible &&
      random.next() < desiredBatchSize * BEHAVIOR_CALIBRATION.compliments.messageShare
        ? random.integer(0, desiredBatchSize - 1)
        : -1;

    const hostSlotPlans = this.planHostSlots(
      input,
      semanticContext,
      newTranscriptSegments,
      activeRoster,
      random,
      desiredBatchSize,
    );
    const reservedIndices = new Set(hostSlotPlans.keys());
    const presenterEventSlots = new Map<number, PresenterEventSlotPlan>();
    if (
      !topicReset &&
      !hostAskedForQuestions &&
      (input.semanticContextRevision ?? 0) > this.lastHandledPresenterRevision &&
      semanticContext.presenterContext.event !== 'none'
    ) {
      const freeIndices = Array.from({ length: desiredBatchSize }, (_, index) => index).filter(
        (index) => !reservedIndices.has(index),
      );
      const eventPlans = presenterEventPlans(
        semanticContext,
        random,
        Math.min(2, freeIndices.length),
      );
      eventPlans.forEach((plan, index) => {
        const slotIndex = freeIndices[index];
        if (slotIndex === undefined) return;
        presenterEventSlots.set(slotIndex, plan);
        reservedIndices.add(slotIndex);
      });
    }
    const viewerDialogueSlots = new Map<number, PlannedViewerDialogueSlot>();
    let ongoingDialogue: ViewerDialogueState | null = null;
    if (!topicReset && !hostAskedForQuestions)
      for (const dialogue of this.viewerDialogues.values())
        if (
          dialogue.recentMessages.length > 0 &&
          dialogue.remainingTurns > 0 &&
          !this.reservedViewerDialogues.has(dialogue.dialogueId)
        ) {
          ongoingDialogue = dialogue;
          break;
        }
    if (
      ongoingDialogue &&
      random.next() < BEHAVIOR_CALIBRATION.conversations.continuationProbability
    ) {
      const lastMessage = ongoingDialogue.recentMessages.at(-1);
      const candidates = ongoingDialogue.participantIds.filter(
        (personaId) => personaId !== lastMessage?.personaId,
      );
      const nextPersonaId = candidates[random.integer(0, candidates.length - 1)];
      const nextPersona = nextPersonaId ? this.rosterById.get(nextPersonaId) : undefined;
      const freeIndices = Array.from({ length: desiredBatchSize }, (_, index) => index).filter(
        (index) => !reservedIndices.has(index),
      );
      const nextIndex = freeIndices[random.integer(0, freeIndices.length - 1)];
      if (lastMessage && nextPersona && nextIndex !== undefined) {
        viewerDialogueSlots.set(nextIndex, {
          dialogueId: ongoingDialogue.dialogueId,
          persona: nextPersona,
          action: 'reply_viewer',
          replyTarget: {
            type: 'viewer',
            personaId: lastMessage.personaId,
            turnId: lastMessage.turnId,
          },
        });
        reservedIndices.add(nextIndex);
        this.reservedViewerDialogues.set(
          ongoingDialogue.dialogueId,
          input.now + BEHAVIOR_CALIBRATION.conversations.lifetimeMs,
        );
      } else ongoingDialogue = null;
    } else ongoingDialogue = null;

    const newDialogue =
      topicReset || hostAskedForQuestions
        ? null
        : this.planViewerDialogue(
            input.sequence,
            input.now,
            desiredBatchSize,
            activeRoster,
            random,
          );
    let newSourceIndex: number | null = null;
    let newReplyIndex: number | null = null;
    if (newDialogue) {
      for (let index = 0; index < desiredBatchSize - 1; index += 1)
        if (!reservedIndices.has(index) && !reservedIndices.has(index + 1)) {
          newSourceIndex = index;
          newReplyIndex = index + 1;
          break;
        }
      const firstId = newDialogue.participantIds[0];
      const secondId = newDialogue.participantIds[1];
      const first = firstId ? this.rosterById.get(firstId) : undefined;
      const second = secondId ? this.rosterById.get(secondId) : undefined;
      if (first && second && newSourceIndex !== null && newReplyIndex !== null) {
        const sourceSlotId = `slot_${input.sequence}_${newSourceIndex}`;
        viewerDialogueSlots.set(newSourceIndex, {
          dialogueId: newDialogue.dialogueId,
          persona: first,
          action: 'start_viewer',
        });
        viewerDialogueSlots.set(newReplyIndex, {
          dialogueId: newDialogue.dialogueId,
          persona: second,
          action: 'reply_viewer',
          replyTarget: { type: 'viewer', personaId: first.id, turnId: sourceSlotId },
        });
        this.reservedViewerDialogues.set(
          newDialogue.dialogueId,
          input.now + BEHAVIOR_CALIBRATION.conversations.lifetimeMs,
        );
      } else {
        newSourceIndex = null;
        newReplyIndex = null;
      }
    }

    const selectedPersonas = new Map<string, AudiencePersona>();
    const usedInOrdinarySlots = new Set<string>();
    const recentAuthorIds = new Set(this.recentAuthorIds);
    const activeByLanguage: Record<'ru' | 'en', AudiencePersona[]> = { ru: [], en: [] };
    for (const persona of activeRoster) activeByLanguage[persona.primaryLanguage].push(persona);
    const isAvailableOrdinaryPersona = (candidate: AudiencePersona) =>
      !recentAuthorIds.has(candidate.id) && !usedInOrdinarySlots.has(candidate.id);
    const slots: CommentSlot[] = [];
    const hasRussianPersonas = activeByLanguage.ru.length > 0;
    const hasEnglishPersonas = activeByLanguage.en.length > 0;
    let ongoingPresenterTargets = 0;
    let invitedQuestionIndex = 0;
    for (let index = 0; index < desiredBatchSize; index += 1) {
      const hostPlan = hostSlotPlans.get(index);
      const presenterEventPlan = presenterEventSlots.get(index);
      const plannedViewerDialogue = viewerDialogueSlots.get(index);
      const language: 'ru' | 'en' = hostPlan
        ? hostPlan.persona.primaryLanguage
        : plannedViewerDialogue
          ? plannedViewerDialogue.persona.primaryLanguage
          : hasEnglishPersonas &&
              (!hasRussianPersonas || random.next() >= BEHAVIOR_CALIBRATION.language.russianShare)
            ? 'en'
            : 'ru';
      const languageCandidates = activeByLanguage[language];
      const persona =
        hostPlan?.persona ??
        plannedViewerDialogue?.persona ??
        weightedPick(languageCandidates, random, this.memories, isAvailableOrdinaryPersona) ??
        weightedPick(languageCandidates, random, this.memories);
      if (!persona) continue;
      selectedPersonas.set(persona.id, persona);
      if (!hostPlan && !plannedViewerDialogue) usedInOrdinarySlots.add(persona.id);

      let kind: CommentKind;
      if (hostPlan) kind = 'speech_reaction';
      else if (presenterEventPlan) kind = presenterEventPlan.kind;
      else if (plannedViewerDialogue?.action === 'reply_viewer') kind = 'viewer_reply';
      else if (hostAskedForQuestions && index < questionCount) kind = 'question';
      else if (index < speechReactionCount + (hostAskedForQuestions ? questionCount : 0))
        kind = 'speech_reaction';
      else if (!hostAskedForQuestions && index < speechReactionCount + questionCount)
        kind = 'question';
      else if (index === complimentIndex) kind = 'observation';
      else if (input.sequence === 1 && random.next() < BEHAVIOR_CALIBRATION.style.greetingShare)
        kind = 'greeting';
      else kind = random.next() < BEHAVIOR_CALIBRATION.style.reactionShare ? 'reaction' : 'casual';

      const slotId = `slot_${input.sequence}_${index}`;
      let dialogueId: string | undefined =
        hostPlan?.dialogueId ?? plannedViewerDialogue?.dialogueId;
      let dialogueAction: DialogueAction | undefined =
        hostPlan?.action ?? plannedViewerDialogue?.action;
      let replyTarget: DialogueReplyTarget | undefined =
        hostPlan?.replyTarget ?? plannedViewerDialogue?.replyTarget;
      if (hostPlan) {
        const reserved = this.hostDialogues.reserve({
          generationSequence: input.sequence,
          slotId,
          dialogueId: hostPlan.dialogueId,
          personaId: persona.id,
          language: persona.primaryLanguage,
          action: hostPlan.action,
          replyTarget: hostPlan.replyTarget,
          hostTurn: hostPlan.hostTurn,
          ...(hostPlan.audienceSequence === undefined
            ? {}
            : { audienceSequence: hostPlan.audienceSequence }),
          ...(hostPlan.allowReplacement === undefined
            ? {}
            : { allowReplacement: hostPlan.allowReplacement }),
          now: input.now,
        });
        if (!reserved) {
          dialogueId = undefined;
          dialogueAction = undefined;
          replyTarget = undefined;
          kind = 'speech_reaction';
        }
      } else if (!plannedViewerDialogue && kind === 'question') {
        const questionDialogueId = `host_${slotId}`;
        const questionReplyTarget: DialogueReplyTarget = {
          type: 'host',
          transcriptSequence: currentUtteranceEnd?.sequence ?? 0,
        };
        if (
          this.hostDialogues.reserve({
            generationSequence: input.sequence,
            slotId,
            dialogueId: questionDialogueId,
            personaId: persona.id,
            language: persona.primaryLanguage,
            action: 'ask_host',
            replyTarget: questionReplyTarget,
            ...(hostAskedForQuestions ? { allowReplacement: true } : {}),
            now: input.now,
          })
        ) {
          dialogueId = questionDialogueId;
          dialogueAction = 'ask_host';
          replyTarget = questionReplyTarget;
        } else kind = 'casual';
      }

      const proposeTopic = remainingTopicProposals > 0 && kind !== 'viewer_reply';
      if (proposeTopic) remainingTopicProposals -= 1;
      const mayTargetVisiblePresenter =
        !topicReset &&
        !hostAskedForQuestions &&
        semanticContext.presenterContext.visibleCount >= 2 &&
        semanticContext.presenterContext.visibleCount <= 3 &&
        !hostPlan &&
        !presenterEventPlan &&
        !plannedViewerDialogue &&
        (kind === 'question' || kind === 'observation') &&
        ongoingPresenterTargets < 2 &&
        random.next() < 0.1;
      const presenterInstruction = mayTargetVisiblePresenter
        ? ongoingPresenterInstruction(semanticContext, kind as 'question' | 'observation', random)
        : null;
      if (presenterInstruction) ongoingPresenterTargets += 1;
      const complimentParticipant = semanticContext.presenterContext.participants.find(
        ({ id }) => id === semanticContext.presenterContext.complimentTargetId,
      );
      const complimentLabel = trustedPresenterLabel(complimentParticipant);
      const complimentInstruction =
        index === complimentIndex && semanticContext.presenterContext.complimentCue
          ? `Можно сделать небольшой уважительный комплимент ${complimentLabel ? `участнику ${complimentLabel}` : 'человеку в кадре'} только по этой подсказке: ${semanticContext.presenterContext.complimentCue}`
          : null;
      const invitedQuestion =
        hostAskedForQuestions && kind === 'question'
          ? invitedQuestionInstruction(
              INVITED_QUESTION_ANGLES[
                (input.sequence + invitedQuestionIndex++) % INVITED_QUESTION_ANGLES.length
              ] ?? INVITED_QUESTION_ANGLES[0],
            )
          : null;
      const slot: CommentSlot = {
        slotId,
        personaId: persona.id,
        language: persona.primaryLanguage,
        kind,
        length: chooseLength(random, load),
        casing: persona.style.casing,
        allowVisualClaim: hostPlan?.allowVisualClaim ?? false,
        allowEmoji:
          random.next() <
          interpolate(
            BEHAVIOR_CALIBRATION.style.emojiShare.conversational,
            BEHAVIOR_CALIBRATION.style.emojiShare.overloaded,
            load,
          ) *
            (persona.style.tone === 'emoji' ? 1.35 : 0.85),
        allowTypo: random.next() < persona.style.typoProbability,
        instruction:
          hostPlan?.instruction ??
          presenterEventPlan?.instruction ??
          presenterInstruction ??
          complimentInstruction ??
          invitedQuestion ??
          instructionFor(
            kind,
            semanticContext,
            input.transcriptChanged,
            proposeTopic,
            topicReset,
            dialogueAction,
          ),
        ...(dialogueId ? { dialogueId } : {}),
        ...(dialogueAction ? { dialogueAction } : {}),
        ...(replyTarget ? { replyTarget } : {}),
      };
      slots.push(slot);
    }

    const effectiveNewDialogue =
      newDialogue && newSourceIndex !== null && newReplyIndex !== null ? newDialogue : null;
    this.pendingPlans.set(input.sequence, {
      newDialogue: effectiveNewDialogue,
      newSourceSlotId:
        effectiveNewDialogue && newSourceIndex !== null
          ? `slot_${input.sequence}_${newSourceIndex}`
          : null,
      newReplySlotId:
        effectiveNewDialogue && newReplyIndex !== null
          ? `slot_${input.sequence}_${newReplyIndex}`
          : null,
      continuingDialogueId: ongoingDialogue?.dialogueId ?? null,
      continuingSlotId:
        ongoingDialogue === null
          ? null
          : (slots.find(
              (slot) =>
                slot.dialogueId === ongoingDialogue.dialogueId &&
                slot.dialogueAction === 'reply_viewer',
            )?.slotId ?? null),
      presenterEventRevision:
        presenterEventSlots.size > 0 ? (input.semanticContextRevision ?? 0) : null,
      presenterEventSlotIds: slots
        .filter((slot) => presenterEventSlots.has(Number(slot.slotId.split('_').at(-1))))
        .map(({ slotId }) => slotId),
    });
    const openDialogues = this.getOpenDialogues(input.now).filter((dialogue) =>
      selectedPersonas.has(dialogue.personaId),
    );
    const personas = [...selectedPersonas.values()];
    return {
      personas,
      slots,
      memories: personas.flatMap((persona) => {
        const memory = this.memories.get(persona.id);
        return memory
          ? [
              {
                personaId: persona.id,
                recentMessages: [...memory.recentMessages],
                participationCount: memory.participationCount,
              },
            ]
          : [];
      }),
      noveltyTexts: [...this.noveltyTexts],
      semanticContext,
      openDialogues,
    };
  }

  resetTopic(transcriptSequence: number): boolean {
    if (transcriptSequence <= 0 || transcriptSequence <= this.lastTopicResetSequence) return false;
    this.lastTopicResetSequence = transcriptSequence;
    this.hostDialogues.reset();
    this.viewerDialogues.clear();
    this.pendingPlans.clear();
    this.acceptedDialogueStarts.clear();
    this.acceptedViewerReplies.clear();
    this.reservedViewerDialogues.clear();
    for (const memory of this.memories.values()) memory.recentMessages.length = 0;
    this.noveltyTexts = [];
    return true;
  }

  recordBatch(sequence: number, comments: GeneratedAudienceComment[]): void {
    this.hostDialogues.recordBatch(sequence, comments);
    const pending = this.pendingPlans.get(sequence);
    this.pendingPlans.delete(sequence);
    if (!pending) return;
    const acceptedSlotIds = new Set(comments.map(({ slotId }) => slotId));
    if (
      pending.newDialogue &&
      pending.newSourceSlotId &&
      pending.newReplySlotId &&
      acceptedSlotIds.has(pending.newSourceSlotId) &&
      acceptedSlotIds.has(pending.newReplySlotId)
    ) {
      this.acceptedDialogueStarts.set(pending.newSourceSlotId, {
        dialogue: pending.newDialogue,
        expiresAt: pending.newDialogue.expiresAt,
      });
      this.acceptedViewerReplies.set(pending.newReplySlotId, {
        dialogueId: pending.newDialogue.dialogueId,
        expiresAt: pending.newDialogue.expiresAt,
      });
    } else if (pending.newDialogue)
      this.reservedViewerDialogues.delete(pending.newDialogue.dialogueId);

    if (pending.continuingDialogueId && pending.continuingSlotId) {
      if (acceptedSlotIds.has(pending.continuingSlotId))
        this.acceptedViewerReplies.set(pending.continuingSlotId, {
          dialogueId: pending.continuingDialogueId,
          expiresAt:
            this.reservedViewerDialogues.get(pending.continuingDialogueId) ??
            this.viewerDialogues.get(pending.continuingDialogueId)?.expiresAt ??
            0,
        });
      else this.reservedViewerDialogues.delete(pending.continuingDialogueId);
    }
    if (
      pending.presenterEventRevision !== null &&
      pending.presenterEventSlotIds.some((slotId) => acceptedSlotIds.has(slotId))
    )
      this.lastHandledPresenterRevision = Math.max(
        this.lastHandledPresenterRevision,
        pending.presenterEventRevision,
      );
  }

  recordFailure(sequence: number): void {
    this.hostDialogues.recordFailure(sequence);
    const pending = this.pendingPlans.get(sequence);
    this.pendingPlans.delete(sequence);
    if (pending?.newDialogue) this.reservedViewerDialogues.delete(pending.newDialogue.dialogueId);
    if (pending?.continuingDialogueId)
      this.reservedViewerDialogues.delete(pending.continuingDialogueId);
  }

  recordRendered(comment: GeneratedAudienceComment, now: number): void {
    this.hostDialogues.recordRendered(comment, now);
    const memory = this.memories.get(comment.personaId) ?? {
      recentMessages: [],
      participationCount: 0,
    };
    memory.recentMessages.push(comment.text);
    if (memory.recentMessages.length > MAX_PERSONA_MESSAGES) memory.recentMessages.shift();
    memory.participationCount += 1;
    this.renderedMessageCount += 1;
    if (comment.kind === 'observation') this.lastComplimentAt = this.renderedMessageCount;
    this.memories.set(comment.personaId, memory);
    this.noveltyTexts.push(comment.text);
    if (this.noveltyTexts.length > MAX_NOVELTY_TEXTS) this.noveltyTexts.shift();
    this.recentAuthorIds.push(comment.personaId);
    if (this.recentAuthorIds.length > BEHAVIOR_CALIBRATION.authorCooldownMessages)
      this.recentAuthorIds.shift();

    if (!comment.dialogueId) return;
    if (comment.dialogueAction === 'start_viewer') {
      const accepted = this.acceptedDialogueStarts.get(comment.slotId);
      this.acceptedDialogueStarts.delete(comment.slotId);
      if (accepted) this.viewerDialogues.set(accepted.dialogue.dialogueId, accepted.dialogue);
    }
    if (comment.dialogueAction !== 'start_viewer' && comment.dialogueAction !== 'reply_viewer')
      return;
    const dialogue = this.viewerDialogues.get(comment.dialogueId);
    if (dialogue && !dialogue.recentMessages.some(({ turnId }) => turnId === comment.slotId)) {
      dialogue.recentMessages.push({
        turnId: comment.slotId,
        personaId: comment.personaId,
        text: comment.text,
      });
      if (dialogue.recentMessages.length > 6) dialogue.recentMessages.shift();
      dialogue.remainingTurns -= 1;
      dialogue.expiresAt = now + BEHAVIOR_CALIBRATION.conversations.lifetimeMs;
      if (dialogue.remainingTurns <= 0) {
        this.viewerDialogues.delete(dialogue.dialogueId);
        this.reservedViewerDialogues.delete(dialogue.dialogueId);
      }
    }
    if (comment.dialogueAction === 'reply_viewer') {
      const accepted = this.acceptedViewerReplies.get(comment.slotId);
      this.acceptedViewerReplies.delete(comment.slotId);
      if (accepted) this.reservedViewerDialogues.delete(accepted.dialogueId);
    }
  }

  stop(): void {
    this.hostDialogues.stop();
    this.memories.clear();
    this.viewerDialogues.clear();
    this.pendingPlans.clear();
    this.acceptedDialogueStarts.clear();
    this.acceptedViewerReplies.clear();
    this.reservedViewerDialogues.clear();
    this.noveltyTexts = [];
    this.recentAuthorIds = [];
    this.renderedMessageCount = 0;
    this.activePoolTarget = 0;
    this.lastHandledPresenterRevision = 0;
    this.lastTopicResetSequence = 0;
  }

  getOpenDialogues(now: number): OpenDialogueContext[] {
    return this.enrichOpenDialogues(this.hostDialogues.getOpenDialogues(now));
  }

  private enrichOpenDialogues(
    dialogues: readonly OpenDialogueStateContext[],
  ): OpenDialogueContext[] {
    return dialogues.flatMap((dialogue) => {
      const persona = this.rosterById.get(dialogue.personaId);
      const identity = persona ? sanitizeDialogueIdentity(persona) : null;
      return identity ? [{ ...dialogue, ...identity }] : [];
    });
  }

  private planHostSlots(
    input: DirectorPlanInput,
    semanticContext: SemanticContext,
    newTranscriptSegments: readonly TranscriptSegment[],
    activeRoster: AudiencePersona[],
    random: Prng,
    desiredBatchSize: number,
  ): Map<number, HostSlotPlan> {
    const plans = new Map<number, HostSlotPlan>();
    if (!input.transcriptChanged || newTranscriptSegments.length === 0) return plans;
    const openDialogues = this.getOpenDialogues(input.now);
    const target = semanticContext.hostTarget;
    const targetSegment = newTranscriptSegments.find(
      (segment) => segment.sequence === target.transcriptSequence,
    );
    if (!targetSegment) return plans;
    const hostUtterance = newTranscriptSegments.map(({ text }) => text).join(' ');
    if (target.type === 'viewer') {
      const dialogue = openDialogues.find(
        (candidate) =>
          candidate.dialogueId === target.dialogueId &&
          candidate.personaId === target.personaId &&
          candidate.status === 'awaiting_host' &&
          latestViewerTurn(candidate)?.turnId === target.turnId,
      );
      const persona = dialogue ? this.rosterById.get(dialogue.personaId) : undefined;
      if (dialogue && persona) {
        const canContinue = this.hostDialogues.canContinue(dialogue.dialogueId, input.now);
        const action: HostSlotPlan['action'] =
          semanticContext.hostIntent === 'question'
            ? 'answer_host'
            : canContinue &&
                random.next() < BEHAVIOR_CALIBRATION.hostDialogues.continuationProbability
              ? 'follow_up_host'
              : 'acknowledge_host';
        const allowVisualClaim =
          action === 'answer_host' &&
          visualGroundingMatches(semanticContext, targetSegment.sequence);
        plans.set(0, {
          persona,
          dialogueId: dialogue.dialogueId,
          action,
          replyTarget: { type: 'host', transcriptSequence: targetSegment.sequence },
          instruction: allowVisualClaim
            ? visualAnswerInstruction(semanticContext)
            : instructionFor('speech_reaction', semanticContext, true, false, false, action),
          allowVisualClaim,
          hostTurn: { transcriptSequence: targetSegment.sequence, text: hostUtterance },
        });
        return plans;
      }
    }

    const broadQuestion =
      semanticContext.hostIntent === 'question' && semanticContext.hostTarget.type === 'audience';
    if (!broadQuestion || !this.hostDialogues.isAudienceSequenceAvailable(targetSegment.sequence))
      return plans;
    const asksAboutCurrentFrame = analyzeHostUtterance(hostUtterance).referencesCurrentFrame;
    const answerTarget =
      asksAboutCurrentFrame && semanticContext.visualGrounding.status === 'none'
        ? 1
        : Math.min(
            desiredBatchSize,
            random.integer(
              BEHAVIOR_CALIBRATION.hostDialogues.answerCount[0],
              BEHAVIOR_CALIBRATION.hostDialogues.answerCount[1],
            ),
          );
    const selectedIds = new Set<string>();
    for (let index = 0; index < answerTarget; index += 1) {
      const persona = weightedPick(
        activeRoster,
        random,
        this.memories,
        (candidate) => !selectedIds.has(candidate.id),
      );
      if (!persona) break;
      selectedIds.add(persona.id);
      const allowVisualClaim =
        index < 2 && visualGroundingMatches(semanticContext, targetSegment.sequence);
      plans.set(index, {
        persona,
        dialogueId: `host_audience_${targetSegment.sequence}_${persona.id}`,
        action: 'answer_host',
        replyTarget: { type: 'host', transcriptSequence: targetSegment.sequence },
        instruction: allowVisualClaim
          ? visualAnswerInstruction(semanticContext)
          : asksAboutCurrentFrame
            ? 'Один раз коротко скажи, что предмет пока не удалось уверенно различить. Не называй предполагаемый предмет, темноту, свет, фон или положение тела.'
            : 'Ответь на вопрос ведущего прямо и естественно от первого лица. Используй язык этого зрителя, не повторяй вопрос и не задавай встречный.',
        allowVisualClaim,
        hostTurn: { transcriptSequence: targetSegment.sequence, text: hostUtterance },
        audienceSequence: targetSegment.sequence,
        allowReplacement: true,
      });
    }
    return plans;
  }

  private planViewerDialogue(
    sequence: number,
    now: number,
    desiredBatchSize: number,
    activeRoster: AudiencePersona[],
    random: Prng,
  ): ViewerDialogueState | null {
    if (
      this.viewerDialogues.size + this.reservedViewerDialogues.size >=
        BEHAVIOR_CALIBRATION.conversations.maximumActive ||
      random.next() >=
        Math.min(0.2, (BEHAVIOR_CALIBRATION.conversations.messageShare * desiredBatchSize) / 2)
    )
      return null;
    const language: 'ru' | 'en' =
      random.next() < BEHAVIOR_CALIBRATION.language.russianShare ? 'ru' : 'en';
    const candidates = activeRoster.filter((persona) => persona.primaryLanguage === language);
    if (candidates.length < 2) return null;
    const participantCount = Math.min(candidates.length, random.next() < 0.85 ? 2 : 3);
    const participants: AudiencePersona[] = [];
    const available = [...candidates];
    while (participants.length < participantCount) {
      const persona = weightedPick(available, random, this.memories);
      if (!persona) break;
      participants.push(persona);
      available.splice(
        available.findIndex((candidate) => candidate.id === persona.id),
        1,
      );
    }
    if (participants.length < 2) return null;
    return {
      dialogueId: `thread_${sequence}_${Math.floor(random.next() * 0xffffff).toString(16)}`,
      participantIds: participants.map((persona) => persona.id),
      language,
      recentMessages: [],
      remainingTurns: random.integer(
        BEHAVIOR_CALIBRATION.conversations.minimumTurns,
        BEHAVIOR_CALIBRATION.conversations.maximumTurns,
      ),
      expiresAt: now + BEHAVIOR_CALIBRATION.conversations.lifetimeMs,
    };
  }

  private pruneViewerDialogues(now: number): void {
    for (const [id, dialogue] of this.viewerDialogues)
      if (dialogue.expiresAt <= now || dialogue.remainingTurns <= 0) {
        this.viewerDialogues.delete(id);
        this.reservedViewerDialogues.delete(id);
      }
    for (const [id, expiresAt] of this.reservedViewerDialogues)
      if (expiresAt <= now) this.reservedViewerDialogues.delete(id);
    for (const [slotId, accepted] of this.acceptedDialogueStarts)
      if (accepted.expiresAt <= now) {
        this.acceptedDialogueStarts.delete(slotId);
        this.reservedViewerDialogues.delete(accepted.dialogue.dialogueId);
      }
    for (const [slotId, accepted] of this.acceptedViewerReplies)
      if (accepted.expiresAt <= now) {
        this.acceptedViewerReplies.delete(slotId);
        this.reservedViewerDialogues.delete(accepted.dialogueId);
      }
  }

  private selectActivePool(currentViewers: number, now: number): AudiencePersona[] {
    const calculatedTarget = Math.min(calculateActivePoolSize(currentViewers), this.roster.length);
    if (
      this.activePoolTarget === 0 ||
      Math.abs(calculatedTarget - this.activePoolTarget) / Math.max(1, this.activePoolTarget) >=
        BEHAVIOR_CALIBRATION.audience.poolHysteresis
    )
      this.activePoolTarget = calculatedTarget;
    const target = Math.min(this.activePoolTarget, this.roster.length);
    const regularCount = Math.min(
      target,
      Math.max(3, Math.round(target * BEHAVIOR_CALIBRATION.audience.regularShare)),
    );
    const requiredIds = new Set<string>(this.hostDialogues.getActivePersonaIds(now));
    for (const dialogue of this.viewerDialogues.values())
      for (const participantId of dialogue.participantIds) requiredIds.add(participantId);
    const selected = this.roster.slice(0, regularCount);
    const selectedIds = new Set<string>();
    for (const persona of selected) selectedIds.add(persona.id);
    for (const persona of this.roster) {
      if (!requiredIds.has(persona.id) || selectedIds.has(persona.id)) continue;
      selected.push(persona);
      selectedIds.add(persona.id);
    }
    const rotationBucket = Math.floor(now / BEHAVIOR_CALIBRATION.audience.rotationMs);
    const random = createPrng(`${this.seed}:audience-pool:${rotationBucket}`);
    const rotating: AudiencePersona[] = [];
    for (const persona of this.roster) if (!selectedIds.has(persona.id)) rotating.push(persona);
    for (let index = rotating.length - 1; index > 0; index -= 1) {
      const swapIndex = random.integer(0, index);
      const current = rotating[index];
      const swap = rotating[swapIndex];
      if (!current || !swap) continue;
      rotating[index] = swap;
      rotating[swapIndex] = current;
    }
    const rotatingCount = Math.max(0, Math.max(target, selected.length) - selected.length);
    for (let index = 0; index < rotatingCount; index += 1) {
      const persona = rotating[index];
      if (persona) selected.push(persona);
    }
    return selected;
  }
}

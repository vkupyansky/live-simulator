import { z } from 'zod';
import type {
  ActivityLevel,
  AudiencePersona,
  TargetViewers,
  TranscriptSegment,
} from '@/shared/types/broadcast';
import type { GeneratedAudienceComment } from '@/features/comments/scheduler';
import type { FrameQualityMetrics } from '@/features/vision/frame';

export const COMMENT_KINDS = [
  'observation',
  'speech_reaction',
  'reaction',
  'question',
  'greeting',
  'casual',
  'viewer_reply',
] as const;

export type CommentKind = (typeof COMMENT_KINDS)[number];
export type CommentLength = 'short' | 'medium' | 'long';
export type CommentCasing = 'lower' | 'sentence' | 'mixed';

export const DIALOGUE_ACTIONS = [
  'ask_host',
  'answer_host',
  'acknowledge_host',
  'follow_up_host',
  'start_viewer',
  'reply_viewer',
] as const;

export type DialogueAction = (typeof DIALOGUE_ACTIONS)[number];
export type DialogueReplyTarget =
  | { type: 'host'; transcriptSequence: number }
  | { type: 'viewer'; personaId: string; turnId: string };

export interface DialogueTurnContext {
  turnId: string;
  role: 'host' | 'viewer';
  personaId: string;
  text: string;
  replyToTurnId: string;
}

export interface OpenDialogueContext {
  dialogueId: string;
  personaId: string;
  displayName: string;
  username: string;
  language: 'ru' | 'en';
  status: 'awaiting_host' | 'awaiting_viewer';
  turns: DialogueTurnContext[];
}

export interface HostTarget {
  type: 'none' | 'audience' | 'viewer';
  transcriptSequence: number;
  dialogueId: string;
  turnId: string;
  personaId: string;
}

export const PRESENTER_IDS = ['primary', 'guest_1', 'guest_2'] as const;
export type PresenterId = (typeof PRESENTER_IDS)[number];
export type PresenterReference = 'none' | PresenterId;

export interface PresenterParticipant {
  id: PresenterId;
  label: string;
  labelSource: 'configured' | 'spoken' | 'generic';
  visible: boolean;
  visualAnchor: string;
}

export interface PresenterContext {
  visibleCount: number;
  participants: PresenterParticipant[];
  event: 'none' | 'joined' | 'left' | 'returned' | 'replaced';
  eventParticipantId: PresenterReference;
  eventCue: string;
  complimentTargetId: PresenterReference;
  complimentCue: string;
}

export interface VisualGrounding {
  status: 'none' | 'uncertain' | 'confirmed';
  label: string;
  transcriptSequence: number;
  frameSequence: number;
}

export interface SemanticContext {
  sceneSummary: string;
  conversationSummary: string;
  topic: string;
  topicResetSequence: number;
  hostIntent: 'ambient' | 'question' | 'answer' | 'story' | 'request_questions' | 'request_topics';
  hostTarget: HostTarget;
  presenterContext: PresenterContext;
  visualGrounding: VisualGrounding;
  audienceDirection: {
    reactToSpeech: boolean;
    questionShare: number;
    suggestedTopics: string[];
    keyFacts: string[];
  };
}

export const EMPTY_SEMANTIC_CONTEXT: SemanticContext = {
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
    questionShare: 0.14,
    suggestedTopics: [],
    keyFacts: [],
  },
};

export interface ContextAnalysisRequest {
  sessionId: string;
  sequence: number;
  currentViewers: number;
  targetViewers: TargetViewers;
  activity: ActivityLevel;
  host: { displayName: string; username: string };
  transcriptSegments: TranscriptSegment[];
  newTranscriptSequences: number[];
  recentComments: Array<{ personaId: string; text: string }>;
  openDialogues: OpenDialogueContext[];
  previousContext: SemanticContext;
  sceneChanged: boolean;
  transcriptChanged: boolean;
  frameDataUrl?: string;
  frameMetadata?: FrameQualityMetrics & {
    width: number;
    height: number;
    byteLength: number;
  };
}

export interface CommentSlot {
  slotId: string;
  personaId: string;
  language: 'ru' | 'en';
  kind: CommentKind;
  length: CommentLength;
  casing: CommentCasing;
  allowEmoji: boolean;
  allowTypo: boolean;
  allowVisualClaim: boolean;
  instruction: string;
  dialogueId?: string;
  dialogueAction?: DialogueAction;
  replyTarget?: DialogueReplyTarget;
}

export interface PersonaMemoryContext {
  personaId: string;
  recentMessages: string[];
  participationCount: number;
}

export interface CommentGenerationRequest {
  sessionId: string;
  sequence: number;
  currentViewers: number;
  targetViewers: TargetViewers;
  activity: ActivityLevel;
  host: { displayName: string; username: string };
  personas: AudiencePersona[];
  slots: CommentSlot[];
  recentComments: Array<{ personaId: string; text: string }>;
  noveltyTexts: string[];
  personaMemories: PersonaMemoryContext[];
  openDialogues: OpenDialogueContext[];
  transcriptSegments: TranscriptSegment[];
  semanticContext: SemanticContext;
}

export interface GeneratedCommentBatch {
  comments: GeneratedAudienceComment[];
}

const runtimeIdentifierSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);

const hostTargetRuntimeSchema = z
  .object({
    type: z.enum(['none', 'audience', 'viewer']),
    transcriptSequence: z.number().int().nonnegative(),
    dialogueId: z.string().max(100),
    turnId: z.string().max(100),
    personaId: z.string().max(100),
  })
  .strict()
  .superRefine((target, context) => {
    const identifiers = [target.dialogueId, target.turnId, target.personaId];
    if (target.type === 'viewer') {
      if (target.transcriptSequence === 0)
        context.addIssue({
          code: 'custom',
          path: ['transcriptSequence'],
          message: 'Viewer target requires a transcript sequence.',
        });
      if (identifiers.some((value) => !runtimeIdentifierSchema.safeParse(value).success))
        context.addIssue({
          code: 'custom',
          path: ['dialogueId'],
          message: 'Viewer target requires valid dialogue identifiers.',
        });
      return;
    }
    if (target.type === 'audience') {
      if (target.transcriptSequence === 0)
        context.addIssue({
          code: 'custom',
          path: ['transcriptSequence'],
          message: 'Audience target requires a transcript sequence.',
        });
      if (identifiers.some(Boolean))
        context.addIssue({
          code: 'custom',
          path: ['dialogueId'],
          message: 'Audience target cannot contain dialogue identifiers.',
        });
      return;
    }
    if (target.transcriptSequence !== 0)
      context.addIssue({
        code: 'custom',
        path: ['transcriptSequence'],
        message: 'No target cannot reference a transcript sequence.',
      });
    if (identifiers.some(Boolean))
      context.addIssue({
        code: 'custom',
        path: ['dialogueId'],
        message: 'Non-viewer target cannot contain dialogue identifiers.',
      });
  });

const presenterParticipantRuntimeSchema = z
  .object({
    id: z.enum(PRESENTER_IDS),
    label: z.string().min(1).max(30),
    labelSource: z.enum(['configured', 'spoken', 'generic']),
    visible: z.boolean(),
    visualAnchor: z.string().max(160),
  })
  .strict();

const presenterContextRuntimeSchema = z
  .object({
    visibleCount: z.number().int().min(0).max(3),
    participants: z.array(presenterParticipantRuntimeSchema).min(1).max(3),
    event: z.enum(['none', 'joined', 'left', 'returned', 'replaced']),
    eventParticipantId: z.enum(['none', ...PRESENTER_IDS]),
    eventCue: z.string().max(160),
    complimentTargetId: z.enum(['none', ...PRESENTER_IDS]),
    complimentCue: z.string().max(120),
  })
  .strict()
  .superRefine((presenter, context) => {
    const ids = presenter.participants.map(({ id }) => id);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', path: ['participants'], message: 'Duplicate presenter.' });
    const primary = presenter.participants.find(({ id }) => id === 'primary');
    if (!primary || primary.labelSource !== 'configured')
      context.addIssue({
        code: 'custom',
        path: ['participants'],
        message: 'The configured primary presenter is required.',
      });
    if (presenter.visibleCount !== presenter.participants.filter(({ visible }) => visible).length)
      context.addIssue({
        code: 'custom',
        path: ['visibleCount'],
        message: 'Visible presenter count does not match participants.',
      });
    if (presenter.participants.some(({ visible, visualAnchor }) => visible && !visualAnchor.trim()))
      context.addIssue({
        code: 'custom',
        path: ['participants'],
        message: 'Visible presenters require a neutral visual anchor.',
      });
    const eventParticipant = presenter.participants.find(
      ({ id }) => id === presenter.eventParticipantId,
    );
    if (
      (presenter.event === 'none' &&
        (presenter.eventParticipantId !== 'none' || presenter.eventCue.trim())) ||
      (presenter.event !== 'none' &&
        (presenter.eventParticipantId === 'none' ||
          !presenter.eventCue.trim() ||
          !eventParticipant))
    )
      context.addIssue({
        code: 'custom',
        path: ['event'],
        message: 'Presenter event metadata is inconsistent.',
      });
    const complimentTarget = presenter.participants.find(
      ({ id }) => id === presenter.complimentTargetId,
    );
    if (
      (presenter.complimentTargetId === 'none' && presenter.complimentCue.trim()) ||
      (presenter.complimentTargetId !== 'none' &&
        (!presenter.complimentCue.trim() || !complimentTarget?.visible))
    )
      context.addIssue({
        code: 'custom',
        path: ['complimentCue'],
        message: 'Compliment metadata must target an exact visible presenter.',
      });
  });

function visualLabelWordCount(value: string): number {
  return value.normalize('NFKC').trim().split(/\s+/u).filter(Boolean).length;
}

const visualGroundingRuntimeSchema = z
  .object({
    status: z.enum(['none', 'uncertain', 'confirmed']),
    label: z.string().max(80),
    transcriptSequence: z.number().int().nonnegative(),
    frameSequence: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((grounding, context) => {
    const label = grounding.label.trim();
    if (grounding.status === 'none') {
      if (label || grounding.transcriptSequence !== 0 || grounding.frameSequence !== 0)
        context.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'Empty visual grounding cannot contain evidence.',
        });
      return;
    }
    if (
      !label ||
      visualLabelWordCount(label) > 4 ||
      grounding.transcriptSequence === 0 ||
      grounding.frameSequence === 0
    )
      context.addIssue({
        code: 'custom',
        path: ['label'],
        message: 'Visual grounding requires a coarse label of at most four words and evidence.',
      });
  });

const semanticContextRuntimeSchema = z
  .object({
    sceneSummary: z.string().max(500),
    conversationSummary: z.string().max(1_200),
    topic: z.string().max(160),
    topicResetSequence: z.number().int().nonnegative(),
    hostIntent: z.enum([
      'ambient',
      'question',
      'answer',
      'story',
      'request_questions',
      'request_topics',
    ]),
    hostTarget: hostTargetRuntimeSchema,
    presenterContext: presenterContextRuntimeSchema,
    visualGrounding: visualGroundingRuntimeSchema,
    audienceDirection: z
      .object({
        reactToSpeech: z.boolean(),
        questionShare: z.number().min(0).max(0.4),
        suggestedTopics: z.array(z.string().min(1).max(80)).max(6),
        keyFacts: z.array(z.string().min(1).max(120)).max(8),
      })
      .strict(),
  })
  .strict()
  .superRefine((semantic, context) => {
    if (semantic.topicResetSequence !== 0 && semantic.visualGrounding.status !== 'none')
      context.addIssue({
        code: 'custom',
        path: ['visualGrounding'],
        message: 'A topic reset must clear visual grounding.',
      });
  });

const generatedCommentRuntimeSchema = z
  .object({
    slotId: runtimeIdentifierSchema,
    personaId: runtimeIdentifierSchema,
    text: z.string().min(1).max(80),
    language: z.enum(['ru', 'en']),
    kind: z.enum(COMMENT_KINDS),
    dialogueId: runtimeIdentifierSchema.optional(),
    dialogueAction: z.enum(DIALOGUE_ACTIONS).optional(),
    replyTarget: z
      .discriminatedUnion('type', [
        z
          .object({
            type: z.literal('host'),
            transcriptSequence: z.number().int().nonnegative(),
          })
          .strict(),
        z
          .object({
            type: z.literal('viewer'),
            personaId: runtimeIdentifierSchema,
            turnId: runtimeIdentifierSchema,
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .superRefine((comment, context) => {
    if (!comment.dialogueAction) {
      if (comment.dialogueId || comment.replyTarget)
        context.addIssue({
          code: 'custom',
          path: ['dialogueAction'],
          message: 'Unexpected dialogue metadata.',
        });
      return;
    }
    if (!comment.dialogueId)
      context.addIssue({
        code: 'custom',
        path: ['dialogueId'],
        message: 'Dialogue action requires an identifier.',
      });
    if (comment.dialogueAction === 'start_viewer') {
      if (comment.replyTarget)
        context.addIssue({
          code: 'custom',
          path: ['replyTarget'],
          message: 'A dialogue start has no reply target.',
        });
      return;
    }
    if (!comment.replyTarget) {
      context.addIssue({
        code: 'custom',
        path: ['replyTarget'],
        message: 'Dialogue action requires a reply target.',
      });
      return;
    }
    if (comment.dialogueAction === 'reply_viewer' && comment.replyTarget.type !== 'viewer')
      context.addIssue({
        code: 'custom',
        path: ['replyTarget'],
        message: 'Viewer reply requires a viewer target.',
      });
    if (
      ['ask_host', 'answer_host', 'acknowledge_host', 'follow_up_host'].includes(
        comment.dialogueAction,
      ) &&
      comment.replyTarget.type !== 'host'
    )
      context.addIssue({
        code: 'custom',
        path: ['replyTarget'],
        message: 'Host dialogue action requires a host target.',
      });
    if (
      comment.replyTarget.type === 'viewer' &&
      comment.replyTarget.personaId === comment.personaId
    )
      context.addIssue({
        code: 'custom',
        path: ['replyTarget', 'personaId'],
        message: 'A persona cannot reply to itself.',
      });
  });

const generatedCommentBatchRuntimeSchema = z
  .object({
    comments: z.array(generatedCommentRuntimeSchema).min(1).max(24),
  })
  .strict();

export function parseRuntimeSemanticContext(value: unknown): SemanticContext {
  return semanticContextRuntimeSchema.parse(value);
}

export function parseRuntimeGeneratedCommentBatch(value: unknown): GeneratedCommentBatch {
  const parsed = generatedCommentBatchRuntimeSchema.parse(value);
  return {
    comments: parsed.comments.map((comment) => ({
      slotId: comment.slotId,
      personaId: comment.personaId,
      text: comment.text,
      language: comment.language,
      kind: comment.kind,
      ...(comment.dialogueId ? { dialogueId: comment.dialogueId } : {}),
      ...(comment.dialogueAction ? { dialogueAction: comment.dialogueAction } : {}),
      ...(comment.replyTarget ? { replyTarget: comment.replyTarget } : {}),
    })),
  };
}

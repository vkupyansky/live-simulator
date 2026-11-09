import { COMMENT_LENGTH_LIMITS, type CommentSlot } from './contracts.js';

export const semanticContextJsonSchema = {
  type: 'object',
  properties: {
    sceneSummary: { type: 'string', maxLength: 500 },
    conversationSummary: { type: 'string', maxLength: 1_200 },
    topic: { type: 'string', maxLength: 160 },
    topicResetSequence: { type: 'integer', minimum: 0 },
    hostIntent: {
      type: 'string',
      enum: ['ambient', 'question', 'answer', 'story', 'request_questions', 'request_topics'],
    },
    hostTarget: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['none', 'audience', 'viewer'] },
        transcriptSequence: { type: 'integer', minimum: 0 },
        dialogueId: { type: 'string', maxLength: 100 },
        turnId: { type: 'string', maxLength: 100 },
        personaId: { type: 'string', maxLength: 100 },
      },
      required: ['type', 'transcriptSequence', 'dialogueId', 'turnId', 'personaId'],
      additionalProperties: false,
    },
    presenterContext: {
      type: 'object',
      properties: {
        visibleCount: { type: 'integer', minimum: 0, maximum: 3 },
        participants: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', enum: ['primary', 'guest_1', 'guest_2'] },
              label: { type: 'string', minLength: 1, maxLength: 30 },
              labelSource: { type: 'string', enum: ['configured', 'spoken', 'generic'] },
              visible: { type: 'boolean' },
              visualAnchor: { type: 'string', maxLength: 160 },
            },
            required: ['id', 'label', 'labelSource', 'visible', 'visualAnchor'],
            additionalProperties: false,
          },
        },
        event: { type: 'string', enum: ['none', 'joined', 'left', 'returned', 'replaced'] },
        eventParticipantId: {
          type: 'string',
          enum: ['none', 'primary', 'guest_1', 'guest_2'],
        },
        eventCue: { type: 'string', maxLength: 160 },
        complimentTargetId: {
          type: 'string',
          enum: ['none', 'primary', 'guest_1', 'guest_2'],
        },
        complimentCue: { type: 'string', maxLength: 120 },
      },
      required: [
        'visibleCount',
        'participants',
        'event',
        'eventParticipantId',
        'eventCue',
        'complimentTargetId',
        'complimentCue',
      ],
      additionalProperties: false,
    },
    visualGrounding: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['none', 'uncertain', 'confirmed'] },
        label: { type: 'string', maxLength: 80 },
        transcriptSequence: { type: 'integer', minimum: 0 },
        frameSequence: { type: 'integer', minimum: 0 },
      },
      required: ['status', 'label', 'transcriptSequence', 'frameSequence'],
      additionalProperties: false,
    },
    audienceDirection: {
      type: 'object',
      properties: {
        reactToSpeech: { type: 'boolean' },
        questionShare: { type: 'number', minimum: 0, maximum: 0.4 },
        suggestedTopics: {
          type: 'array',
          maxItems: 6,
          items: { type: 'string', minLength: 1, maxLength: 80 },
        },
        keyFacts: {
          type: 'array',
          maxItems: 8,
          items: { type: 'string', minLength: 1, maxLength: 120 },
        },
      },
      required: ['reactToSpeech', 'questionShare', 'suggestedTopics', 'keyFacts'],
      additionalProperties: false,
    },
  },
  required: [
    'sceneSummary',
    'conversationSummary',
    'topic',
    'topicResetSequence',
    'hostIntent',
    'hostTarget',
    'presenterContext',
    'visualGrounding',
    'audienceDirection',
  ],
  additionalProperties: false,
} as const;

export const generatedCommentBatchJsonSchema = {
  type: 'object',
  properties: {
    comments: {
      type: 'array',
      minItems: 1,
      maxItems: 24,
      items: {
        type: 'object',
        properties: {
          slotId: { type: 'string', minLength: 1, maxLength: 100 },
          text: { type: 'string', minLength: 1, maxLength: COMMENT_LENGTH_LIMITS.long },
        },
        required: ['slotId', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['comments'],
  additionalProperties: false,
} as const;

export function generatedCommentBatchJsonSchemaForSlots(
  slots: readonly Pick<CommentSlot, 'length'>[],
): Record<string, unknown> {
  const maximumTextLength = Math.max(...slots.map((slot) => COMMENT_LENGTH_LIMITS[slot.length]));
  return {
    ...generatedCommentBatchJsonSchema,
    properties: {
      comments: {
        ...generatedCommentBatchJsonSchema.properties.comments,
        minItems: slots.length,
        maxItems: slots.length,
        items: {
          ...generatedCommentBatchJsonSchema.properties.comments.items,
          properties: {
            ...generatedCommentBatchJsonSchema.properties.comments.items.properties,
            text: {
              ...generatedCommentBatchJsonSchema.properties.comments.items.properties.text,
              maxLength: maximumTextLength,
            },
          },
        },
      },
    },
  };
}

export const capabilityProbeJsonSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const;

import { z } from 'zod';

const identifierSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);

const usernameSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[A-Za-z0-9._]+$/);

const languageSchema = z.enum(['ru', 'en']);

export const COMMENT_LENGTH_LIMITS = {
  short: 36,
  medium: 64,
  long: 80,
} as const;

export const COMMENT_WORD_LIMITS = {
  short: 4,
  medium: 7,
  long: 10,
} as const;

export const commentKindSchema = z.enum([
  'observation',
  'speech_reaction',
  'reaction',
  'question',
  'greeting',
  'casual',
  'viewer_reply',
]);

export const DIALOGUE_ACTIONS = [
  'ask_host',
  'answer_host',
  'acknowledge_host',
  'follow_up_host',
  'start_viewer',
  'reply_viewer',
] as const;

export const dialogueActionSchema = z.enum(DIALOGUE_ACTIONS);

export const dialogueReplyTargetSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('host'),
      transcriptSequence: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('viewer'),
      personaId: identifierSchema,
      turnId: identifierSchema,
    })
    .strict(),
]);

type DialogueMetadata = {
  personaId: string;
  dialogueId?: string | undefined;
  dialogueAction?: z.infer<typeof dialogueActionSchema> | undefined;
  replyTarget?: z.infer<typeof dialogueReplyTargetSchema> | undefined;
};

function dialogueMetadataIssues(
  value: DialogueMetadata,
): Array<{ path: string[]; message: string }> {
  const issues: Array<{ path: string[]; message: string }> = [];
  if (!value.dialogueAction) {
    if (value.dialogueId || value.replyTarget)
      issues.push({
        path: ['dialogueAction'],
        message: 'Dialogue metadata requires an explicit dialogue action.',
      });
    return issues;
  }
  if (!value.dialogueId)
    issues.push({
      path: ['dialogueId'],
      message: 'Dialogue action requires a dialogue identifier.',
    });
  if (value.dialogueAction === 'start_viewer') {
    if (value.replyTarget)
      issues.push({
        path: ['replyTarget'],
        message: 'A viewer dialogue start cannot have a reply target.',
      });
    return issues;
  }
  if (!value.replyTarget) {
    issues.push({
      path: ['replyTarget'],
      message: 'Dialogue action requires a reply target.',
    });
    return issues;
  }
  if (value.dialogueAction === 'reply_viewer' && value.replyTarget.type !== 'viewer')
    issues.push({ path: ['replyTarget'], message: 'Viewer reply requires a viewer target.' });
  if (
    ['ask_host', 'answer_host', 'acknowledge_host', 'follow_up_host'].includes(
      value.dialogueAction,
    ) &&
    value.replyTarget.type !== 'host'
  )
    issues.push({ path: ['replyTarget'], message: 'Host dialogue action requires a host target.' });
  if (value.replyTarget.type === 'viewer' && value.replyTarget.personaId === value.personaId)
    issues.push({
      path: ['replyTarget', 'personaId'],
      message: 'A persona cannot reply to itself.',
    });
  return issues;
}

const hostSchema = z
  .object({
    displayName: z.string().min(1).max(30),
    username: usernameSchema,
  })
  .strict();

export const personaSchema = z
  .object({
    id: identifierSchema,
    username: usernameSchema,
    displayName: z.string().min(1).max(30),
    avatarSeed: z.string().min(1).max(160),
    primaryLanguage: languageSchema,
    style: z
      .object({
        casing: z.enum(['lower', 'sentence', 'mixed']),
        language: languageSchema,
        tone: z.enum(['casual', 'supportive', 'question', 'slang', 'emoji', 'short']),
        typoProbability: z.number().min(0).max(1),
        emojiProbability: z.number().min(0).max(1),
        activityWeight: z.number().positive().max(10),
      })
      .strict(),
  })
  .strict()
  .superRefine((persona, context) => {
    if (persona.primaryLanguage !== persona.style.language)
      context.addIssue({
        code: 'custom',
        path: ['style', 'language'],
        message: 'Persona style language must match its primary language.',
      });
  });

export const transcriptSegmentSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    text: z.string().min(1).max(800),
    startedAtMs: z.number().nonnegative(),
    endedAtMs: z.number().nonnegative(),
    language: z
      .string()
      .min(2)
      .max(20)
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/)
      .optional(),
  })
  .strict()
  .superRefine((segment, context) => {
    if (segment.endedAtMs < segment.startedAtMs)
      context.addIssue({
        code: 'custom',
        path: ['endedAtMs'],
        message: 'Transcript segment cannot end before it starts.',
      });
  });

const recentCommentSchema = z
  .object({
    personaId: identifierSchema,
    text: z.string().min(1).max(80),
  })
  .strict();

export const personaMemorySchema = z
  .object({
    personaId: identifierSchema,
    recentMessages: z.array(z.string().min(1).max(80)).max(8),
    participationCount: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();

export const dialogueTurnContextSchema = z
  .object({
    turnId: identifierSchema,
    role: z.enum(['host', 'viewer']),
    personaId: z.union([z.literal(''), identifierSchema]),
    text: z.string().min(1).max(800),
    replyToTurnId: z.union([z.literal(''), identifierSchema]),
  })
  .strict()
  .superRefine((turn, context) => {
    if (turn.role === 'host' && turn.personaId)
      context.addIssue({
        code: 'custom',
        path: ['personaId'],
        message: 'Host turns cannot carry a viewer persona identifier.',
      });
    if (turn.role === 'viewer' && !turn.personaId)
      context.addIssue({
        code: 'custom',
        path: ['personaId'],
        message: 'Viewer turns require a persona identifier.',
      });
  });

export const openDialogueContextSchema = z
  .object({
    dialogueId: identifierSchema,
    personaId: identifierSchema,
    displayName: z.string().min(1).max(30),
    username: usernameSchema,
    language: languageSchema,
    status: z.enum(['awaiting_host', 'awaiting_viewer']),
    turns: z.array(dialogueTurnContextSchema).min(1).max(6),
  })
  .strict()
  .superRefine((dialogue, context) => {
    const seenTurnIds = new Set<string>();
    for (const [index, turn] of dialogue.turns.entries()) {
      if (seenTurnIds.has(turn.turnId))
        context.addIssue({
          code: 'custom',
          path: ['turns', index, 'turnId'],
          message: 'Dialogue turn identifiers must be unique.',
        });
      if (turn.role === 'viewer' && turn.personaId !== dialogue.personaId)
        context.addIssue({
          code: 'custom',
          path: ['turns', index, 'personaId'],
          message: 'Viewer turns must belong to the dialogue persona.',
        });
      if (turn.replyToTurnId && !seenTurnIds.has(turn.replyToTurnId))
        context.addIssue({
          code: 'custom',
          path: ['turns', index, 'replyToTurnId'],
          message: 'A reply must reference an earlier turn in the dialogue.',
        });
      seenTurnIds.add(turn.turnId);
    }
    const latest = dialogue.turns.at(-1);
    if (
      latest &&
      ((dialogue.status === 'awaiting_host' && latest.role !== 'viewer') ||
        (dialogue.status === 'awaiting_viewer' && latest.role !== 'host'))
    )
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Dialogue status must match the latest speaker.',
      });
  });

export const hostTargetSchema = z
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
      if (identifiers.some((value) => !identifierSchema.safeParse(value).success))
        context.addIssue({
          code: 'custom',
          path: ['dialogueId'],
          message: 'Viewer target requires valid dialogue, turn, and persona identifiers.',
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
          message: 'Audience targets cannot carry dialogue identifiers.',
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
        message: 'Non-viewer targets cannot carry dialogue identifiers.',
      });
  });

export const PRESENTER_IDS = ['primary', 'guest_1', 'guest_2'] as const;
const presenterReferenceSchema = z.enum(['none', ...PRESENTER_IDS]);

export const presenterParticipantSchema = z
  .object({
    id: z.enum(PRESENTER_IDS),
    label: z.string().min(1).max(30),
    labelSource: z.enum(['configured', 'spoken', 'generic']),
    visible: z.boolean(),
    visualAnchor: z.string().max(160),
  })
  .strict();

export const presenterContextSchema = z
  .object({
    visibleCount: z.number().int().min(0).max(3),
    participants: z.array(presenterParticipantSchema).min(1).max(3),
    event: z.enum(['none', 'joined', 'left', 'returned', 'replaced']),
    eventParticipantId: presenterReferenceSchema,
    eventCue: z.string().max(160),
    complimentTargetId: presenterReferenceSchema,
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

export const visualGroundingSchema = z
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

export const semanticContextSchema = z
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
    hostTarget: hostTargetSchema,
    presenterContext: presenterContextSchema,
    visualGrounding: visualGroundingSchema,
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

const sessionContextSchema = z.object({
  sessionId: z
    .string()
    .min(8)
    .max(120)
    .regex(/^[A-Za-z0-9_-]+$/),
  sequence: z.number().int().positive().max(1_000_000),
  currentViewers: z.number().int().min(0).max(1_500_000),
  targetViewers: z.number().int().min(1).max(999_999),
  activity: z.enum(['low', 'normal', 'high']),
  host: hostSchema,
});

export const contextAnalysisRequestSchema = sessionContextSchema
  .extend({
    transcriptSegments: z.array(transcriptSegmentSchema).max(18),
    newTranscriptSequences: z.array(z.number().int().positive()).max(18),
    recentComments: z.array(recentCommentSchema).max(30),
    openDialogues: z.array(openDialogueContextSchema).max(3),
    previousContext: semanticContextSchema,
    frameDataUrl: z
      .string()
      .max(550_000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
      .optional(),
    frameMetadata: z
      .object({
        width: z.number().int().min(1).max(576),
        height: z.number().int().min(1).max(1_024),
        byteLength: z
          .number()
          .int()
          .min(1)
          .max(400 * 1_024),
        meanLuminance: z.number().min(0).max(1),
        luminanceDeviation: z.number().min(0).max(1),
        darkPixelRatio: z.number().min(0).max(1),
        clippedBlackRatio: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    sceneChanged: z.boolean(),
    transcriptChanged: z.boolean(),
  })
  .strict()
  .superRefine((request, context) => {
    const transcriptSequences = request.transcriptSegments.map((segment) => segment.sequence);
    const newSequenceSet = new Set(request.newTranscriptSequences);
    if (
      transcriptSequences.some(
        (sequence, index) => index > 0 && sequence <= (transcriptSequences[index - 1] ?? -1),
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['transcriptSegments'],
        message: 'Transcript segment sequences must be strictly increasing.',
      });
    if (newSequenceSet.size !== request.newTranscriptSequences.length)
      context.addIssue({
        code: 'custom',
        path: ['newTranscriptSequences'],
        message: 'New transcript sequences must be unique.',
      });
    const firstNewIndex = transcriptSequences.findIndex((sequence) => newSequenceSet.has(sequence));
    const expectedNewSequences = firstNewIndex < 0 ? [] : transcriptSequences.slice(firstNewIndex);
    if (
      request.newTranscriptSequences.some(
        (sequence, index) => sequence !== expectedNewSequences[index],
      ) ||
      request.newTranscriptSequences.length !== expectedNewSequences.length
    )
      context.addIssue({
        code: 'custom',
        path: ['newTranscriptSequences'],
        message: 'New transcript sequences must identify an exact transcript suffix.',
      });
    if (request.transcriptChanged !== request.newTranscriptSequences.length > 0)
      context.addIssue({
        code: 'custom',
        path: ['transcriptChanged'],
        message: 'Transcript changed must match the new transcript boundary.',
      });
    const dialogueIds = new Set<string>();
    const identitiesByPersona = new Map<
      string,
      Pick<(typeof request.openDialogues)[number], 'displayName' | 'username' | 'language'>
    >();
    const personaByUsername = new Map<string, string>();
    for (const [index, dialogue] of request.openDialogues.entries()) {
      if (dialogueIds.has(dialogue.dialogueId))
        context.addIssue({
          code: 'custom',
          path: ['openDialogues', index, 'dialogueId'],
          message: 'Open dialogue identifiers must be unique.',
        });
      dialogueIds.add(dialogue.dialogueId);
      const knownIdentity = identitiesByPersona.get(dialogue.personaId);
      if (
        knownIdentity &&
        (knownIdentity.displayName !== dialogue.displayName ||
          knownIdentity.username !== dialogue.username ||
          knownIdentity.language !== dialogue.language)
      )
        context.addIssue({
          code: 'custom',
          path: ['openDialogues', index, 'personaId'],
          message: 'A persona must keep one identity across open dialogues.',
        });
      else identitiesByPersona.set(dialogue.personaId, dialogue);

      const normalizedUsername = dialogue.username.toLocaleLowerCase('en');
      const usernameOwner = personaByUsername.get(normalizedUsername);
      if (usernameOwner && usernameOwner !== dialogue.personaId)
        context.addIssue({
          code: 'custom',
          path: ['openDialogues', index, 'username'],
          message: 'An open-dialogue username must identify one persona.',
        });
      else personaByUsername.set(normalizedUsername, dialogue.personaId);
    }
  });

export const commentSlotSchema = z
  .object({
    slotId: identifierSchema,
    personaId: identifierSchema,
    language: languageSchema,
    kind: commentKindSchema,
    length: z.enum(['short', 'medium', 'long']),
    casing: z.enum(['lower', 'sentence', 'mixed']),
    allowEmoji: z.boolean(),
    allowTypo: z.boolean(),
    allowVisualClaim: z.boolean(),
    instruction: z.string().min(1).max(200),
    dialogueId: identifierSchema.optional(),
    dialogueAction: dialogueActionSchema.optional(),
    replyTarget: dialogueReplyTargetSchema.optional(),
  })
  .strict()
  .superRefine((slot, context) => {
    for (const entry of dialogueMetadataIssues(slot))
      context.addIssue({
        code: 'custom',
        path: entry.path,
        message: entry.message,
      });
  });

export const commentGenerationRequestSchema = sessionContextSchema
  .extend({
    personas: z.array(personaSchema).min(1).max(24),
    slots: z.array(commentSlotSchema).min(1).max(24),
    recentComments: z.array(recentCommentSchema).max(30),
    noveltyTexts: z.array(z.string().min(1).max(80)).max(300),
    personaMemories: z.array(personaMemorySchema).max(24),
    openDialogues: z.array(openDialogueContextSchema).max(3),
    transcriptSegments: z.array(transcriptSegmentSchema).max(18),
    semanticContext: semanticContextSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const personas = new Map(request.personas.map((persona) => [persona.id, persona]));
    if (personas.size !== request.personas.length)
      context.addIssue({
        code: 'custom',
        path: ['personas'],
        message: 'Persona identifiers must be unique.',
      });

    const slotIds = new Set<string>();
    let visualClaimSlots = 0;
    for (const [index, slot] of request.slots.entries()) {
      const persona = personas.get(slot.personaId);
      if (slotIds.has(slot.slotId))
        context.addIssue({
          code: 'custom',
          path: ['slots', index, 'slotId'],
          message: 'Slot identifiers must be unique.',
        });
      slotIds.add(slot.slotId);
      if (!persona)
        context.addIssue({
          code: 'custom',
          path: ['slots', index, 'personaId'],
          message: 'Slot must reference a batch persona.',
        });
      else if (slot.language !== persona.primaryLanguage)
        context.addIssue({
          code: 'custom',
          path: ['slots', index, 'language'],
          message: 'Slot language must match its persona.',
        });
      if (slot.allowVisualClaim) visualClaimSlots += 1;
    }
    if (visualClaimSlots > 2)
      context.addIssue({
        code: 'custom',
        path: ['slots'],
        message: 'At most two slots can use the current visual grounding.',
      });
    if (visualClaimSlots > 0 && request.semanticContext.visualGrounding.status === 'none')
      context.addIssue({
        code: 'custom',
        path: ['slots'],
        message: 'Visual claim slots require current visual grounding.',
      });

    const dialogueIds = new Set<string>();
    const openViewerTurns = new Map<string, string>();
    for (const [index, dialogue] of request.openDialogues.entries()) {
      if (dialogueIds.has(dialogue.dialogueId))
        context.addIssue({
          code: 'custom',
          path: ['openDialogues', index, 'dialogueId'],
          message: 'Open dialogue identifiers must be unique.',
        });
      if (!personas.has(dialogue.personaId))
        context.addIssue({
          code: 'custom',
          path: ['openDialogues', index, 'personaId'],
          message: 'Open dialogue persona must be present in the generation batch.',
        });
      const dialoguePersona = personas.get(dialogue.personaId);
      if (
        dialoguePersona &&
        (dialogue.displayName !== dialoguePersona.displayName ||
          dialogue.username !== dialoguePersona.username ||
          dialogue.language !== dialoguePersona.primaryLanguage)
      )
        context.addIssue({
          code: 'custom',
          path: ['openDialogues', index, 'username'],
          message: 'Open dialogue identity must match its batch persona.',
        });
      for (const turn of dialogue.turns)
        if (turn.role === 'viewer')
          openViewerTurns.set(`${dialogue.dialogueId}:${turn.turnId}`, turn.personaId);
      dialogueIds.add(dialogue.dialogueId);
    }

    for (const [index, slot] of request.slots.entries()) {
      if (slot.replyTarget?.type !== 'viewer' || !slot.dialogueId) continue;
      const replyTarget = slot.replyTarget;
      const sourceSlot = request.slots.find(
        (candidate) =>
          candidate.slotId === replyTarget.turnId &&
          candidate.personaId === replyTarget.personaId &&
          candidate.dialogueId === slot.dialogueId,
      );
      const openPersonaId = openViewerTurns.get(`${slot.dialogueId}:${replyTarget.turnId}`);
      if (!sourceSlot && openPersonaId !== replyTarget.personaId)
        context.addIssue({
          code: 'custom',
          path: ['slots', index, 'replyTarget'],
          message: 'Viewer reply target must identify an exact turn in the same dialogue.',
        });
    }

    const memoryIds = new Set<string>();
    for (const [index, memory] of request.personaMemories.entries()) {
      if (!personas.has(memory.personaId) || memoryIds.has(memory.personaId))
        context.addIssue({
          code: 'custom',
          path: ['personaMemories', index, 'personaId'],
          message: 'Persona memory must reference one unique batch persona.',
        });
      memoryIds.add(memory.personaId);
    }
  });

export const generatedCommentOutputSchema = z
  .object({
    slotId: identifierSchema,
    text: z.string().min(1).max(80),
  })
  .strict();

export const generatedAudienceCommentSchema = z
  .object({
    slotId: identifierSchema,
    personaId: identifierSchema,
    text: z.string().min(1).max(80),
    language: languageSchema,
    kind: commentKindSchema,
    dialogueId: identifierSchema.optional(),
    dialogueAction: dialogueActionSchema.optional(),
    replyTarget: dialogueReplyTargetSchema.optional(),
  })
  .strict()
  .superRefine((comment, context) => {
    for (const entry of dialogueMetadataIssues(comment))
      context.addIssue({ code: 'custom', path: entry.path, message: entry.message });
  });

export type ContextAnalysisRequest = z.infer<typeof contextAnalysisRequestSchema>;
export type SemanticContext = z.infer<typeof semanticContextSchema>;
export type CommentGenerationRequest = z.infer<typeof commentGenerationRequestSchema>;
export type CommentSlot = z.infer<typeof commentSlotSchema>;
export type DialogueAction = z.infer<typeof dialogueActionSchema>;
export type DialogueReplyTarget = z.infer<typeof dialogueReplyTargetSchema>;
export type DialogueTurnContext = z.infer<typeof dialogueTurnContextSchema>;
export type OpenDialogueContext = z.infer<typeof openDialogueContextSchema>;
export type GeneratedCommentOutput = z.infer<typeof generatedCommentOutputSchema>;
export type GeneratedAudienceComment = z.infer<typeof generatedAudienceCommentSchema>;

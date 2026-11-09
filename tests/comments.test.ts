import { describe, expect, it, vi } from 'vitest';
import { EMPTY_SEMANTIC_CONTEXT } from '@/features/ai/contracts';
import { createAudienceRoster } from '@/features/comments/audience';
import { calculateCommentsPerMinute } from '@/features/audience/model';
import { ConversationDirector } from '@/features/comments/director';
import { BEHAVIOR_CALIBRATION } from '@/features/comments/behavior';
import { analyzeHostUtterance } from '@/features/comments/hostUtterance';
import { COMMENT_QUEUE_LIMIT, CommentScheduler } from '@/features/comments/scheduler';
import { useSessionStore } from '@/features/session/store';
import {
  PERSONA_IDENTITIES_BY_LANGUAGE,
  PERSONA_USERNAME_POOL,
} from '@/features/comments/usernames';
import { MAX_RUNTIME_COMMENTS, type LiveComment } from '@/shared/types/broadcast';

class VisibilityStub {
  hidden = false;
  listeners = new Set<() => void>();

  addEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.delete(listener);
  }

  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.listeners.forEach((listener) => listener());
  }
}

describe('host utterance analysis', () => {
  it.each([
    'давайте о чем-нибудь другом поговорим',
    'давайте поговорим о чём-нибудь другом',
    'сменим тему',
    'про это хватит',
    'let us talk about something else',
    'change the topic',
  ])('detects an explicit topic reset: %s', (transcript) => {
    expect(analyzeHostUtterance(transcript)).toMatchObject({
      explicitRequest: 'request_topics',
      resetsTopic: true,
    });
  });

  it.each([
    'позадавайте мне вопросов',
    'задавайте вопросы',
    'спросите что-нибудь',
    'спросите меня о чём-нибудь',
    'поспрашивайте меня',
    'можете что-нибудь спросить',
  ])('detects an explicit invitation to ask questions: %s', (transcript) => {
    expect(analyzeHostUtterance(transcript).explicitRequest).toBe('request_questions');
  });

  it.each(['я спросил что-нибудь', 'он спросил меня о работе', 'можно что-нибудь спросить?'])(
    'does not turn ordinary speech into a question invitation: %s',
    (transcript) => {
      expect(analyzeHostUtterance(transcript).explicitRequest).toBeNull();
    },
  );

  it.each(['меня слышно?', 'слышно меня?', 'can you hear me?'])(
    'does not manufacture an audience answer from an audio check: %s',
    (transcript) => {
      expect(analyzeHostUtterance(transcript).broadAudienceQuestion).toBe(false);
    },
  );

  it.each([
    'что это?',
    'видите что я показываю?',
    'наушники видно?',
    'различаете часы?',
    'узнаёте предмет?',
    'я показываю наушники',
    'я держу часы перед камерой',
    'что сейчас в кадре?',
    'меня видно?',
    'можете различить?',
    'что у меня в руке?',
    'what is this?',
  ])('detects a current-frame reference: %s', (transcript) => {
    expect(analyzeHostUtterance(transcript).referencesCurrentFrame).toBe(true);
  });

  it('keeps ordinary stories and unrelated questions out of control intents', () => {
    expect(analyzeHostUtterance('вчера мы случайно сменили тему разговора')).toMatchObject({
      explicitRequest: null,
      resetsTopic: false,
      referencesCurrentFrame: false,
    });
    expect(analyzeHostUtterance('какой фильм вы смотрели вчера?')).toMatchObject({
      explicitRequest: null,
      resetsTopic: false,
      referencesCurrentFrame: false,
    });
  });
});

describe('audience domain', () => {
  it('calculates activity-aware rates from the current viewer count', () => {
    expect(calculateCommentsPerMinute(100, 'normal')).toBeLessThan(
      calculateCommentsPerMinute(500, 'normal'),
    );
    expect(calculateCommentsPerMinute(500, 'normal')).toBeLessThan(
      calculateCommentsPerMinute(1_000, 'normal'),
    );
    expect(calculateCommentsPerMinute(500, 'low')).toBeLessThan(
      calculateCommentsPerMinute(500, 'high'),
    );
  });

  it('creates deterministic bounded rosters with stable persona languages', () => {
    const left = createAudienceRoster(1_000, 'roster');
    const right = createAudienceRoster(1_000, 'roster');
    expect(left).toEqual(right);
    expect(left.length).toBeGreaterThanOrEqual(20);
    expect(left.length).toBeLessThanOrEqual(240);
    const englishShare =
      left.filter((persona) => persona.primaryLanguage === 'en').length / left.length;
    expect(englishShare).toBeGreaterThanOrEqual(0.1);
    expect(englishShare).toBeLessThanOrEqual(0.15);
    expect(new Set(left.map((persona) => persona.username)).size).toBe(left.length);
    expect(new Set(left.map((persona) => persona.displayName)).size).toBe(left.length);
  });

  it('creates the maximum 240-person roster without repeating handles or display names', () => {
    const roster = createAudienceRoster(999_999, 'maximum-roster');
    expect(roster).toHaveLength(240);
    expect(new Set(roster.map(({ username }) => username)).size).toBe(roster.length);
    expect(new Set(roster.map(({ displayName }) => displayName)).size).toBe(roster.length);
    const englishShare =
      roster.filter(({ primaryLanguage }) => primaryLanguage === 'en').length / roster.length;
    expect(englishShare).toBeGreaterThanOrEqual(0.1);
    expect(englishShare).toBeLessThanOrEqual(0.15);
  });

  it('provides 5000 unique TikTok-compatible local usernames', () => {
    expect(PERSONA_USERNAME_POOL).toHaveLength(5_000);
    expect(new Set(PERSONA_USERNAME_POOL).size).toBe(5_000);
    expect(PERSONA_IDENTITIES_BY_LANGUAGE.ru).toHaveLength(4_250);
    expect(PERSONA_IDENTITIES_BY_LANGUAGE.en).toHaveLength(750);
    expect(
      PERSONA_USERNAME_POOL.every(
        (username) =>
          /^[a-z0-9._]+$/u.test(username) &&
          !username.endsWith('.') &&
          username.length >= 2 &&
          username.length <= 24,
      ),
    ).toBe(true);
  });

  it('keeps digits rare and avoids synthetic numeric series or concentrated suffixes', () => {
    const numbered = PERSONA_USERNAME_POOL.filter((username) => /\d/u.test(username));
    expect(numbered.length / PERSONA_USERNAME_POOL.length).toBeGreaterThanOrEqual(0.015);
    expect(numbered.length / PERSONA_USERNAME_POOL.length).toBeLessThanOrEqual(0.025);
    expect(numbered).toHaveLength(100);
    expect(
      numbered.some(
        (username) =>
          /(\d)\1{2}/u.test(username) ||
          /(?:012|123|234|345|456|567|678|789|987|876|765|654|543|432|321|210)/u.test(username),
      ),
    ).toBe(false);

    const numericTails = new Map<string, number>();
    for (const username of numbered) {
      const tail = username.match(/\d+$/u)?.[0];
      expect(tail).toMatch(/^\d{2}$/u);
      if (tail) numericTails.set(tail, (numericTails.get(tail) ?? 0) + 1);
    }
    expect(numericTails.size).toBe(50);
    expect(Math.max(...numericTails.values())).toBe(2);
    expect(PERSONA_USERNAME_POOL.some((username) => /([a-z0-9])\1{3}/u.test(username))).toBe(false);
  });

  it('contains independent social, personal, translit, aesthetic, gaming, ironic and initials families', () => {
    const count = (pattern: RegExp) =>
      PERSONA_USERNAME_POOL.filter((username) => pattern.test(username)).length;

    expect(
      count(/(?:callme|hey|hi|im|its|just|maybe|not|ok|only|real|that|the|thisis)/u),
    ).toBeGreaterThan(400);
    expect(
      count(/(?:^|[._])(?:sasha|anya|dasha|katya|mia|emma|chloe|noah)(?:[._]|$)/u),
    ).toBeGreaterThan(15);
    expect(
      count(/(?:koroche|navernoe|prosto|seychas|atmosfera|bezsonnica|razgovor|tishina)/u),
    ).toBeGreaterThan(150);
    expect(
      count(/(?:midnight|velvet|lavender|polaroid|lunar|glossy|horizon|moon)/u),
    ).toBeGreaterThan(150);
    expect(
      count(/(?:lowhp|finalboss|respawning|checkpoint|hitbox|cooldown|speedrun|unranked)/u),
    ).toBeGreaterThan(120);
    expect(
      count(/(?:almosta|apparently|nobodyasked|notreally|okaybut|totallynot|braincell|overshare)/u),
    ).toBeGreaterThan(120);
    expect(count(/(?:^|[._])[a-z]{2}(?:[._]|\d{2}$|$)/u)).toBeGreaterThan(180);

    expect(
      PERSONA_USERNAME_POOL.filter((username) => username.includes('.')).length,
    ).toBeGreaterThan(900);
    expect(
      PERSONA_USERNAME_POOL.filter((username) => username.includes('_')).length,
    ).toBeGreaterThan(900);
    expect(
      PERSONA_USERNAME_POOL.filter((username) => !/[._]/u.test(username)).length,
    ).toBeGreaterThan(2_500);
  });

  it('avoids repeated handle templates and preserves unique session display names', () => {
    const identities = [...PERSONA_IDENTITIES_BY_LANGUAGE.ru, ...PERSONA_IDENTITIES_BY_LANGUAGE.en];
    expect(new Set(identities.map(({ displayName }) => displayName)).size).toBe(5_000);
    expect(
      identities.every(({ username, displayName }) => {
        const baseUsername = username.replace(/[._]?\d{2}$/u, '');
        return displayName.toLocaleLowerCase('en') === baseUsername;
      }),
    ).toBe(true);

    const handleSkeletons = PERSONA_USERNAME_POOL.map((username) =>
      username.replace(/[._]?\d{2}$/u, '').replace(/[._]/gu, ''),
    );
    expect(new Set(handleSkeletons).size).toBeGreaterThan(4_900);

    const edgeTokenFrequency = new Map<string, number>();
    for (const username of PERSONA_USERNAME_POOL) {
      const withoutNumber = username.replace(/[._]?\d{2}$/u, '');
      const tokens = withoutNumber.split(/[._]/u);
      const first = tokens[0];
      const last = tokens.at(-1);
      if (first)
        edgeTokenFrequency.set(
          `first:${first}`,
          (edgeTokenFrequency.get(`first:${first}`) ?? 0) + 1,
        );
      if (last)
        edgeTokenFrequency.set(`last:${last}`, (edgeTokenFrequency.get(`last:${last}`) ?? 0) + 1);
    }
    expect(Math.max(...edgeTokenFrequency.values())).toBeLessThan(75);
  });
});

describe('conversation director', () => {
  const presenterChangeContext = {
    ...EMPTY_SEMANTIC_CONTEXT,
    presenterContext: {
      visibleCount: 2,
      participants: [
        {
          id: 'primary' as const,
          label: 'Sara',
          labelSource: 'configured' as const,
          visible: true,
          visualAnchor: 'слева',
        },
        {
          id: 'guest_1' as const,
          label: 'Марк',
          labelSource: 'spoken' as const,
          visible: true,
          visualAnchor: 'справа',
        },
      ],
      event: 'joined' as const,
      eventParticipantId: 'guest_1' as const,
      eventCue: 'в кадре появился второй человек',
      complimentTargetId: 'none' as const,
      complimentCue: '',
    },
  };

  const basicPresenterPlan = (sequence: number) => ({
    sequence,
    desiredBatchSize: 8,
    currentViewers: 500,
    commentsPerMinute: 12,
    transcriptSegments: [],
    newTranscriptSequences: [],
    transcriptChanged: false,
    semanticContext: presenterChangeContext,
    semanticContextRevision: 1,
    now: sequence * 1_000,
  });

  it('retries one bounded presenter-change reaction until a planned slot is accepted', () => {
    const roster = createAudienceRoster(500, 'presenter-change-roster');
    const director = new ConversationDirector('presenter-change', roster);
    const first = director.plan(basicPresenterPlan(1));
    const firstEventSlots = first.slots.filter((slot) =>
      /смена людей|нового человека/iu.test(slot.instruction),
    );
    expect(firstEventSlots.length).toBeGreaterThanOrEqual(1);
    expect(firstEventSlots.length).toBeLessThanOrEqual(2);
    expect(firstEventSlots[0]).toMatchObject({ kind: 'question', dialogueAction: 'ask_host' });

    director.recordFailure(1);
    const retry = director.plan(basicPresenterPlan(2));
    const retryEventSlots = retry.slots.filter((slot) =>
      /смена людей|нового человека/iu.test(slot.instruction),
    );
    expect(retryEventSlots.length).toBeGreaterThanOrEqual(1);
    const accepted = retryEventSlots[0];
    if (!accepted) throw new Error('Presenter event slot fixture is missing.');
    director.recordBatch(2, [
      {
        slotId: accepted.slotId,
        personaId: accepted.personaId,
        text: 'а кто это рядом?',
        language: accepted.language,
        kind: accepted.kind,
        ...(accepted.dialogueId ? { dialogueId: accepted.dialogueId } : {}),
        ...(accepted.dialogueAction ? { dialogueAction: accepted.dialogueAction } : {}),
        ...(accepted.replyTarget ? { replyTarget: accepted.replyTarget } : {}),
      },
    ]);

    const handled = director.plan(basicPresenterPlan(3));
    expect(
      handled.slots.some((slot) => /смена людей|нового человека/iu.test(slot.instruction)),
    ).toBe(false);
    director.recordFailure(3);
    director.stop();
    const afterCleanup = director.plan(basicPresenterPlan(4));
    expect(
      afterCleanup.slots.some((slot) => /смена людей|нового человека/iu.test(slot.instruction)),
    ).toBe(true);
  });

  it('keeps an exact host dialogue ahead of a presenter-change reaction', () => {
    const roster = createAudienceRoster(500, 'presenter-priority-roster');
    const persona = roster[0];
    if (!persona) throw new Error('Presenter priority persona fixture is missing.');
    const director = new ConversationDirector('presenter-priority', roster);
    director.recordRendered(
      {
        slotId: 'viewer-question',
        personaId: persona.id,
        text: 'куда ты поедешь?',
        language: persona.primaryLanguage,
        kind: 'question',
        dialogueId: 'exact-dialogue',
        dialogueAction: 'ask_host',
        replyTarget: { type: 'host', transcriptSequence: 0 },
      },
      500,
    );
    const plan = director.plan({
      ...basicPresenterPlan(1),
      desiredBatchSize: 2,
      transcriptSegments: [{ sequence: 7, text: 'в Италию', startedAtMs: 600, endedAtMs: 900 }],
      newTranscriptSequences: [7],
      transcriptChanged: true,
      semanticContext: {
        ...presenterChangeContext,
        hostIntent: 'answer',
        hostTarget: {
          type: 'viewer',
          transcriptSequence: 7,
          dialogueId: 'exact-dialogue',
          turnId: 'viewer-question',
          personaId: persona.id,
        },
      },
    });
    expect(plan.slots[0]).toMatchObject({ dialogueId: 'exact-dialogue', personaId: persona.id });
    expect(plan.slots[1]?.instruction).toMatch(/смена людей|нового человека/iu);
  });

  it('rarely targets a trusted visible presenter without exceeding two ordinary slots per batch', () => {
    const roster = createAudienceRoster(1_000, 'ongoing-presenters-roster');
    const director = new ConversationDirector('ongoing-presenters', roster);
    let targeted = 0;
    for (let sequence = 1; sequence <= 24; sequence += 1) {
      const plan = director.plan({
        ...basicPresenterPlan(sequence),
        desiredBatchSize: 24,
        semanticContext: {
          ...presenterChangeContext,
          presenterContext: {
            ...presenterChangeContext.presenterContext,
            event: 'none',
            eventParticipantId: 'none',
            eventCue: '',
          },
        },
        semanticContextRevision: sequence,
      });
      const presenterSlots = plan.slots.filter((slot) =>
        /видимому участнику|всем людям, которые сейчас видны/iu.test(slot.instruction),
      );
      expect(presenterSlots.length).toBeLessThanOrEqual(2);
      expect(
        presenterSlots.every((slot) => !slot.dialogueId || slot.dialogueAction === 'ask_host'),
      ).toBe(true);
      targeted += presenterSlots.length;
      director.recordFailure(sequence);
    }
    expect(targeted).toBeGreaterThan(0);
  });

  it('plans an exact deterministic batch with persona-language locks and style controls', () => {
    const roster = createAudienceRoster(1_000, 'director-roster');
    const input = {
      sequence: 7,
      desiredBatchSize: 24,
      currentViewers: 1_000,
      commentsPerMinute: 20,
      transcriptSegments: [],
      newTranscriptSequences: [],
      transcriptChanged: false,
      semanticContext: EMPTY_SEMANTIC_CONTEXT,
      now: 2_000,
    } as const;
    const left = new ConversationDirector('director-seed', roster).plan(input);
    const right = new ConversationDirector('director-seed', roster).plan(input);

    expect(left).toEqual(right);
    expect(left.slots).toHaveLength(24);
    expect(new Set(left.slots.map((slot) => slot.slotId)).size).toBe(24);
    const personaById = new Map(left.personas.map((persona) => [persona.id, persona]));
    for (const slot of left.slots) {
      expect(personaById.get(slot.personaId)?.primaryLanguage).toBe(slot.language);
      expect(typeof slot.allowEmoji).toBe('boolean');
      expect(typeof slot.allowTypo).toBe('boolean');
      expect(typeof slot.allowVisualClaim).toBe('boolean');
      expect(['lower', 'sentence', 'mixed']).toContain(slot.casing);
      expect(slot.instruction.length).toBeGreaterThan(0);
    }
    expect(left.slots.filter((slot) => slot.allowEmoji).length).toBeLessThanOrEqual(3);
    expect(left.slots.filter((slot) => slot.allowTypo).length).toBeLessThanOrEqual(3);
  });

  it('places a viewer reply after the addressed viewer and keeps the dialogue language', () => {
    const roster = createAudienceRoster(1_000, 'dialogue-roster');
    const director = new ConversationDirector('dialogue-seed', roster);
    let slots: ReturnType<ConversationDirector['plan']>['slots'] = [];
    for (let sequence = 1; sequence <= 200; sequence += 1) {
      slots = director.plan({
        sequence,
        desiredBatchSize: 12,
        currentViewers: 1_000,
        commentsPerMinute: 20,
        transcriptSegments: [],
        newTranscriptSequences: [],
        transcriptChanged: false,
        semanticContext: EMPTY_SEMANTIC_CONTEXT,
        now: sequence * 1_000,
      }).slots;
      if (slots.some((slot) => slot.kind === 'viewer_reply')) break;
    }

    const replyIndex = slots.findIndex((slot) => slot.kind === 'viewer_reply');
    expect(replyIndex).toBeGreaterThan(0);
    const source = slots[replyIndex - 1];
    const reply = slots[replyIndex];
    expect(source).toBeDefined();
    expect(reply).toMatchObject({
      dialogueId: source?.dialogueId,
      dialogueAction: 'reply_viewer',
      replyTarget: {
        type: 'viewer',
        personaId: source?.personaId,
        turnId: source?.slotId,
      },
      language: source?.language,
    });
    expect(source?.dialogueAction).toBe('start_viewer');
  });

  it('turns an explicit topic request into topic proposals instead of questions back to the host', () => {
    const roster = createAudienceRoster(500, 'topic-request-roster');
    const plan = new ConversationDirector('topic-request', roster).plan({
      sequence: 1,
      desiredBatchSize: 8,
      currentViewers: 500,
      commentsPerMinute: 12,
      transcriptSegments: [
        {
          sequence: 1,
          text: 'предложите какую-нибудь',
          startedAtMs: 100,
          endedAtMs: 600,
          language: 'ru',
        },
        {
          sequence: 2,
          text: 'тему для разговора',
          startedAtMs: 650,
          endedAtMs: 1_000,
          language: 'ru',
        },
      ],
      newTranscriptSequences: [1, 2],
      transcriptChanged: true,
      semanticContext: EMPTY_SEMANTIC_CONTEXT,
      now: 1_100,
    });

    expect(plan.semanticContext.hostIntent).toBe('request_topics');
    expect(plan.slots.some((slot) => slot.kind === 'question')).toBe(false);
    const proposals = plan.slots.filter((slot) => slot.kind !== 'viewer_reply');
    expect(proposals.length).toBeGreaterThan(0);
    expect(
      proposals.filter((slot) =>
        slot.instruction.startsWith('Сам предложи одну конкретную тему для разговора.'),
      ),
    ).toHaveLength(2);
    expect(proposals.every((slot) => !slot.instruction.startsWith('Задай ведущему'))).toBe(true);
  });

  it('bounds a question invitation to its exact turn and requests varied concrete questions', () => {
    const roster = createAudienceRoster(500, 'question-invitation-roster');
    const director = new ConversationDirector('question-invitation', roster);
    const existingQuestionAuthors = roster
      .filter(({ primaryLanguage }) => primaryLanguage === 'ru')
      .slice(0, 3);
    expect(existingQuestionAuthors).toHaveLength(3);
    existingQuestionAuthors.forEach((persona, index) =>
      director.recordRendered(
        {
          slotId: `old_question_${index}`,
          personaId: persona.id,
          text: `старый вопрос ${index}`,
          language: 'ru',
          kind: 'question',
          dialogueId: `old_dialogue_${index}`,
          dialogueAction: 'ask_host',
          replyTarget: { type: 'host', transcriptSequence: 0 },
        },
        100 + index,
      ),
    );
    expect(director.getOpenDialogues(500)).toHaveLength(3);
    const invitationContext = {
      ...EMPTY_SEMANTIC_CONTEXT,
      conversationSummary: 'ведущий просит вопросы по жизни',
      topic: 'вопросы по жизни',
      hostIntent: 'request_questions' as const,
      hostTarget: {
        type: 'audience' as const,
        transcriptSequence: 1,
        dialogueId: '',
        turnId: '',
        personaId: '',
      },
      presenterContext: {
        ...EMPTY_SEMANTIC_CONTEXT.presenterContext,
        visibleCount: 2,
        participants: [
          ...EMPTY_SEMANTIC_CONTEXT.presenterContext.participants,
          {
            id: 'guest_1' as const,
            label: 'Гость',
            labelSource: 'generic' as const,
            visible: true,
            visualAnchor: 'справа',
          },
        ],
        event: 'joined' as const,
        eventParticipantId: 'guest_1' as const,
        eventCue: 'в кадре появился гость',
      },
      audienceDirection: {
        ...EMPTY_SEMANTIC_CONTEXT.audienceDirection,
        reactToSpeech: true,
      },
    };
    const invitation = director.plan({
      sequence: 1,
      desiredBatchSize: 4,
      currentViewers: 500,
      commentsPerMinute: 12,
      transcriptSegments: [
        {
          sequence: 1,
          text: 'задайте мне вопросы по жизни',
          startedAtMs: 100,
          endedAtMs: 800,
          language: 'ru',
        },
      ],
      newTranscriptSequences: [1],
      transcriptChanged: true,
      semanticContext: invitationContext,
      semanticContextRevision: 1,
      now: 900,
    });

    const invitedQuestions = invitation.slots.filter(
      (slot) => slot.kind === 'question' && slot.instruction.startsWith('Задай конкретный вопрос'),
    );
    expect(invitation.semanticContext.hostIntent).toBe('request_questions');
    expect(invitedQuestions).toHaveLength(2);
    expect(invitation.slots.slice(0, 2)).toEqual(invitedQuestions);
    expect(
      invitation.slots.every(
        ({ dialogueAction, instruction }) =>
          dialogueAction !== 'start_viewer' &&
          dialogueAction !== 'reply_viewer' &&
          !instruction.includes('Подтверждена смена людей'),
      ),
    ).toBe(true);
    expect(new Set(invitedQuestions.map(({ instruction }) => instruction)).size).toBe(
      invitedQuestions.length,
    );
    expect(invitation.slots.every(({ instruction }) => Array.from(instruction).length <= 200)).toBe(
      true,
    );
    expect(
      invitedQuestions.every(
        ({ instruction }) =>
          instruction.startsWith('Задай конкретный вопрос ведущему') &&
          instruction.includes('Не повторяй просьбу') &&
          instruction.includes('«какой вопрос выбрать»'),
      ),
    ).toBe(true);

    director.recordFailure(1);

    const largeInvitation = new ConversationDirector('large-question-invitation', roster).plan({
      sequence: 1,
      desiredBatchSize: 24,
      currentViewers: 5_000,
      commentsPerMinute: 40,
      transcriptSegments: [
        {
          sequence: 1,
          text: 'спросите меня о чём-нибудь',
          startedAtMs: 100,
          endedAtMs: 800,
          language: 'ru',
        },
      ],
      newTranscriptSequences: [1],
      transcriptChanged: true,
      semanticContext: invitationContext,
      now: 900,
    });
    expect(
      largeInvitation.slots.filter(
        (slot) =>
          slot.kind === 'question' && slot.instruction.startsWith('Задай конкретный вопрос'),
      ),
    ).toHaveLength(3);

    const withoutNewSpeech = director.plan({
      sequence: 2,
      desiredBatchSize: 8,
      currentViewers: 500,
      commentsPerMinute: 12,
      transcriptSegments: [],
      newTranscriptSequences: [],
      transcriptChanged: false,
      semanticContext: invitationContext,
      now: 4_500,
    });
    expect(withoutNewSpeech.semanticContext).toMatchObject({
      conversationSummary: '',
      topic: '',
      hostIntent: 'ambient',
      hostTarget: { type: 'none' },
      audienceDirection: { reactToSpeech: false },
    });
    expect(
      withoutNewSpeech.slots.some((slot) => slot.instruction.startsWith('Задай конкретный вопрос')),
    ).toBe(false);

    const acknowledgment = director.plan({
      sequence: 3,
      desiredBatchSize: 8,
      currentViewers: 500,
      commentsPerMinute: 12,
      transcriptSegments: [
        {
          sequence: 2,
          text: 'да, вопросы по жизни',
          startedAtMs: 5_000,
          endedAtMs: 5_500,
          language: 'ru',
        },
      ],
      newTranscriptSequences: [2],
      transcriptChanged: true,
      semanticContext: {
        ...invitationContext,
        hostTarget: { ...invitationContext.hostTarget, transcriptSequence: 2 },
      },
      now: 5_600,
    });
    expect(acknowledgment.semanticContext).toMatchObject({
      conversationSummary: '',
      topic: '',
      hostIntent: 'ambient',
      hostTarget: { type: 'none' },
    });
    expect(
      acknowledgment.slots.some((slot) => slot.instruction.startsWith('Задай конкретный вопрос')),
    ).toBe(false);
  });

  it('resets topic-scoped dialogue and memory once, then plans only new topics or agreement', () => {
    const persona = createAudienceRoster(100, 'topic-reset-roster').find(
      (candidate) => candidate.primaryLanguage === 'ru',
    );
    if (!persona) throw new Error('Russian persona fixture is missing.');
    const director = new ConversationDirector('topic-reset', [persona]);
    director.recordRendered(
      {
        slotId: 'old-question',
        personaId: persona.id,
        text: 'а какие именно часы?',
        language: 'ru',
        kind: 'question',
        dialogueId: 'old-watch-dialogue',
        dialogueAction: 'ask_host',
        replyTarget: { type: 'host', transcriptSequence: 0 },
      },
      1_000,
    );
    director.recordRendered(
      {
        slotId: 'old-comment',
        personaId: persona.id,
        text: 'смартфон на лбу',
        language: 'ru',
        kind: 'observation',
      },
      1_100,
    );
    expect(director.getOpenDialogues(1_200)).toHaveLength(1);

    const plan = director.plan({
      sequence: 3,
      desiredBatchSize: 8,
      currentViewers: 100,
      commentsPerMinute: 6,
      transcriptSegments: [
        {
          sequence: 7,
          text: 'давайте о чем-нибудь другом поговорим',
          startedAtMs: 1_300,
          endedAtMs: 2_000,
          language: 'ru',
        },
      ],
      newTranscriptSequences: [7],
      transcriptChanged: true,
      semanticContext: {
        ...EMPTY_SEMANTIC_CONTEXT,
        sceneSummary: 'на лбу смартфон',
        conversationSummary: 'обсуждают смартфон',
        topic: 'смартфон',
        audienceDirection: {
          ...EMPTY_SEMANTIC_CONTEXT.audienceDirection,
          keyFacts: ['смартфон находится на лбу'],
        },
      },
      now: 2_100,
    });

    expect(plan.openDialogues).toEqual([]);
    expect(plan.noveltyTexts).toEqual([]);
    expect(plan.memories).toEqual([
      expect.objectContaining({ personaId: persona.id, recentMessages: [], participationCount: 2 }),
    ]);
    expect(plan.semanticContext).toMatchObject({
      sceneSummary: '',
      conversationSummary: '',
      topic: '',
      topicResetSequence: 7,
      hostIntent: 'request_topics',
      hostTarget: { type: 'none' },
      visualGrounding: { status: 'none' },
      audienceDirection: { keyFacts: [] },
    });
    const proposals = plan.slots.filter((slot) =>
      slot.instruction.startsWith('Сам предложи одну конкретную тему'),
    );
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(proposals.length).toBeLessThanOrEqual(3);
    expect(
      plan.slots.every(
        (slot) =>
          slot.instruction.startsWith('Сам предложи одну конкретную тему') ||
          slot.instruction.startsWith('Коротко и естественно согласись сменить тему'),
      ),
    ).toBe(true);
    expect(plan.slots.every((slot) => slot.allowVisualClaim === false)).toBe(true);
    expect(director.resetTopic(7)).toBe(false);
  });

  it.each([
    ['uncertain', 'небольшой предмет', 'похоже на небольшой предмет'],
    ['confirmed', 'наручные часы', 'наручные часы'],
  ] as const)(
    'allows at most two grounded visual answers for a %s current-frame result',
    (status, label, expectedInstruction) => {
      const roster = createAudienceRoster(500, `visual-${status}`);
      const plan = new ConversationDirector(`visual-${status}`, roster).plan({
        sequence: 1,
        desiredBatchSize: 8,
        currentViewers: 500,
        commentsPerMinute: 12,
        transcriptSegments: [
          {
            sequence: 10,
            text: 'видите что я показываю, что это?',
            startedAtMs: 100,
            endedAtMs: 900,
            language: 'ru',
          },
        ],
        newTranscriptSequences: [10],
        transcriptChanged: true,
        semanticContext: {
          ...EMPTY_SEMANTIC_CONTEXT,
          hostIntent: 'question',
          hostTarget: {
            type: 'audience',
            transcriptSequence: 10,
            dialogueId: '',
            turnId: '',
            personaId: '',
          },
          visualGrounding: {
            status,
            label,
            transcriptSequence: 10,
            frameSequence: 1,
          },
        },
        now: 1_000,
      });

      const visualSlots = plan.slots.filter((slot) => slot.allowVisualClaim);
      expect(visualSlots).toHaveLength(2);
      expect(
        visualSlots.every(
          (slot) =>
            slot.dialogueAction === 'answer_host' &&
            slot.replyTarget?.type === 'host' &&
            slot.replyTarget.transcriptSequence === 10 &&
            slot.instruction.includes(expectedInstruction),
        ),
      ).toBe(true);
      expect(
        plan.slots
          .filter((slot) => !visualSlots.includes(slot))
          .every((slot) => slot.allowVisualClaim === false),
      ).toBe(true);
    },
  );

  it('emits one honest visual fallback when a fresh frame has no grounded object', () => {
    const roster = createAudienceRoster(500, 'visual-none');
    const plan = new ConversationDirector('visual-none', roster).plan({
      sequence: 1,
      desiredBatchSize: 8,
      currentViewers: 500,
      commentsPerMinute: 12,
      transcriptSegments: [
        {
          sequence: 10,
          text: 'наушники видно, что я держу перед камерой?',
          startedAtMs: 100,
          endedAtMs: 900,
          language: 'ru',
        },
      ],
      newTranscriptSequences: [10],
      transcriptChanged: true,
      semanticContext: {
        ...EMPTY_SEMANTIC_CONTEXT,
        hostIntent: 'question',
        hostTarget: {
          type: 'audience',
          transcriptSequence: 10,
          dialogueId: '',
          turnId: '',
          personaId: '',
        },
      },
      now: 1_000,
    });

    const directAnswers = plan.slots.filter(
      ({ dialogueAction }) => dialogueAction === 'answer_host',
    );
    expect(directAnswers).toHaveLength(1);
    expect(directAnswers[0]).toMatchObject({ allowVisualClaim: false });
    expect(directAnswers[0]?.instruction).toContain('предмет пока не удалось уверенно различить');
    expect(directAnswers[0]?.instruction).toContain('Не называй предполагаемый предмет, темноту');
  });

  it('keeps an exact viewer target when the addressed request also looks like a broad topic request', () => {
    const persona = createAudienceRoster(100, 'exact-topic-target-roster').find(
      (candidate) => candidate.primaryLanguage === 'ru',
    );
    if (!persona) throw new Error('Russian persona fixture is missing.');
    const director = new ConversationDirector('exact-topic-target', [persona]);
    director.recordRendered(
      {
        slotId: 'viewer-topic-turn',
        personaId: persona.id,
        text: 'а о чём сегодня поговорим?',
        language: 'ru',
        kind: 'question',
        dialogueId: 'viewer-topic-dialogue',
        dialogueAction: 'ask_host',
        replyTarget: { type: 'host', transcriptSequence: 0 },
      },
      1_000,
    );

    const exactTarget = {
      type: 'viewer' as const,
      transcriptSequence: 1,
      dialogueId: 'viewer-topic-dialogue',
      turnId: 'viewer-topic-turn',
      personaId: persona.id,
    };
    const plan = director.plan({
      sequence: 1,
      desiredBatchSize: 4,
      currentViewers: 100,
      commentsPerMinute: 6,
      transcriptSegments: [
        {
          sequence: 1,
          text: 'предложи тему',
          startedAtMs: 1_100,
          endedAtMs: 1_600,
          language: 'ru',
        },
      ],
      newTranscriptSequences: [1],
      transcriptChanged: true,
      semanticContext: {
        ...EMPTY_SEMANTIC_CONTEXT,
        hostIntent: 'question',
        hostTarget: exactTarget,
      },
      now: 1_700,
    });

    expect(plan.semanticContext.hostIntent).toBe('question');
    expect(plan.semanticContext.hostTarget).toEqual(exactTarget);
    expect(plan.slots[0]).toMatchObject({
      personaId: persona.id,
      dialogueId: 'viewer-topic-dialogue',
      dialogueAction: 'answer_host',
      replyTarget: { type: 'host', transcriptSequence: 1 },
    });
  });

  it('does not manufacture audience answers for a rhetorical non-addressed host question', () => {
    const roster = createAudienceRoster(500, 'rhetorical-question-roster');
    for (const [sequence, text] of [
      [1, 'зачем я это сделал?'],
      [2, 'что вы думаете, зачем я это сделал?'],
    ] as const) {
      const plan = new ConversationDirector(`rhetorical-question-${sequence}`, roster).plan({
        sequence,
        desiredBatchSize: 8,
        currentViewers: 500,
        commentsPerMinute: 12,
        transcriptSegments: [
          {
            sequence,
            text,
            startedAtMs: 100,
            endedAtMs: 900,
            language: 'ru',
          },
        ],
        newTranscriptSequences: [sequence],
        transcriptChanged: true,
        semanticContext: {
          ...EMPTY_SEMANTIC_CONTEXT,
          hostIntent: 'question',
          hostTarget: {
            type: 'none',
            transcriptSequence: 0,
            dialogueId: '',
            turnId: '',
            personaId: '',
          },
        },
        now: 1_000,
      });

      expect(plan.semanticContext.hostTarget.type).toBe('none');
      expect(
        plan.slots.some(
          (slot) =>
            slot.dialogueAction === 'answer_host' ||
            slot.dialogueAction === 'acknowledge_host' ||
            slot.dialogueAction === 'follow_up_host',
        ),
      ).toBe(false);
    }
  });

  it('keeps a skipped question open and advances only an explicitly addressed viewer after render', () => {
    const roster = createAudienceRoster(100, 'memory-roster').filter(
      (persona) => persona.primaryLanguage === 'ru',
    );
    const persona = roster[0];
    if (!persona) throw new Error('Russian persona fixture is missing.');
    const director = new ConversationDirector('memory-seed', [persona]);
    director.recordRendered(
      {
        slotId: 'question-slot',
        personaId: persona.id,
        text: 'а куда ты хочешь поехать?',
        language: 'ru',
        kind: 'question',
        dialogueId: 'host_question_slot',
        dialogueAction: 'ask_host',
        replyTarget: { type: 'host', transcriptSequence: 0 },
      },
      1_000,
    );

    const beforeAnswer = director.plan({
      sequence: 1,
      desiredBatchSize: 1,
      currentViewers: 100,
      commentsPerMinute: 6,
      transcriptSegments: [],
      newTranscriptSequences: [],
      transcriptChanged: false,
      semanticContext: EMPTY_SEMANTIC_CONTEXT,
      now: 1_500,
    });
    const openDialogue = beforeAnswer.openDialogues[0];
    expect(openDialogue).toMatchObject({
      dialogueId: 'host_question_slot',
      personaId: persona.id,
      status: 'awaiting_host',
    });
    expect(openDialogue?.turns).toHaveLength(1);
    director.recordFailure(1);

    const unrelatedSpeechPlan = director.plan({
      sequence: 2,
      desiredBatchSize: 1,
      currentViewers: 100,
      commentsPerMinute: 6,
      transcriptSegments: [
        {
          sequence: 2,
          text: 'сегодня хочу рассказать про новый свет в комнате',
          startedAtMs: 1_600,
          endedAtMs: 2_100,
        },
      ],
      newTranscriptSequences: [2],
      transcriptChanged: true,
      semanticContext: {
        ...EMPTY_SEMANTIC_CONTEXT,
        hostIntent: 'story',
      },
      now: 2_200,
    });
    expect(unrelatedSpeechPlan.slots.some((slot) => slot.dialogueId === 'host_question_slot')).toBe(
      false,
    );
    expect(
      unrelatedSpeechPlan.openDialogues.some(
        (dialogue) => dialogue.dialogueId === 'host_question_slot',
      ),
    ).toBe(true);
    director.recordFailure(2);

    const hostReplyPlan = director.plan({
      sequence: 3,
      desiredBatchSize: 1,
      currentViewers: 100,
      commentsPerMinute: 6,
      transcriptSegments: [
        {
          sequence: 3,
          text: 'думаю поехать в Италию',
          startedAtMs: 1_600,
          endedAtMs: 2_100,
        },
      ],
      newTranscriptSequences: [3],
      transcriptChanged: true,
      semanticContext: {
        ...EMPTY_SEMANTIC_CONTEXT,
        hostIntent: 'answer',
        hostTarget: {
          type: 'viewer',
          transcriptSequence: 3,
          dialogueId: 'host_question_slot',
          turnId: 'question-slot',
          personaId: persona.id,
        },
      },
      now: 2_800,
    });
    const replySlot = hostReplyPlan.slots[0];
    expect(replySlot).toMatchObject({
      personaId: persona.id,
      dialogueId: 'host_question_slot',
      replyTarget: { type: 'host', transcriptSequence: 3 },
    });
    expect(['acknowledge_host', 'follow_up_host']).toContain(replySlot?.dialogueAction);

    if (!replySlot) throw new Error('Host reply slot is missing.');
    const generatedReply = {
      slotId: replySlot.slotId,
      personaId: replySlot.personaId,
      text: 'класс, Италия звучит здорово',
      language: replySlot.language,
      kind: replySlot.kind,
      ...(replySlot.dialogueId ? { dialogueId: replySlot.dialogueId } : {}),
      ...(replySlot.dialogueAction ? { dialogueAction: replySlot.dialogueAction } : {}),
      ...(replySlot.replyTarget ? { replyTarget: replySlot.replyTarget } : {}),
    };
    director.recordBatch(3, [generatedReply]);
    const duplicatePlan = director.plan({
      sequence: 4,
      desiredBatchSize: 1,
      currentViewers: 100,
      commentsPerMinute: 6,
      transcriptSegments: [
        {
          sequence: 3,
          text: 'думаю поехать в Италию',
          startedAtMs: 1_600,
          endedAtMs: 2_100,
        },
      ],
      newTranscriptSequences: [3],
      transcriptChanged: true,
      semanticContext: hostReplyPlan.semanticContext,
      now: 2_900,
    });
    expect(duplicatePlan.slots.some((slot) => slot.dialogueId === 'host_question_slot')).toBe(
      false,
    );
    director.recordFailure(4);
    director.recordRendered(generatedReply, 3_000);
  });

  it('routes an explicit username to one exact branch among three trusted roster identities', () => {
    const roster = createAudienceRoster(100, 'identity-route-roster').slice(0, 3);
    expect(roster).toHaveLength(3);
    const director = new ConversationDirector('identity-route-seed', roster);
    roster.forEach((persona, index) => {
      director.recordRendered(
        {
          slotId: `identity-question-${index}`,
          personaId: persona.id,
          text: `вопрос номер ${index}`,
          language: persona.primaryLanguage,
          kind: 'question',
          dialogueId: `identity-dialogue-${index}`,
          dialogueAction: 'ask_host',
          replyTarget: { type: 'host', transcriptSequence: 0 },
        },
        1_000 + index,
      );
    });
    const target = roster[2];
    if (!target) throw new Error('Identity route fixture is missing.');
    const open = director.getOpenDialogues(1_100);
    expect(open).toHaveLength(3);
    expect(open.find(({ personaId }) => personaId === target.id)).toMatchObject({
      displayName: target.displayName,
      username: target.username,
    });

    const plan = director.plan({
      sequence: 1,
      desiredBatchSize: 1,
      currentViewers: 100,
      commentsPerMinute: 6,
      transcriptSegments: [
        {
          sequence: 7,
          text: `@${target.username}, да, отвечаю именно тебе`,
          startedAtMs: 2_000,
          endedAtMs: 2_700,
          language: target.primaryLanguage,
        },
      ],
      newTranscriptSequences: [7],
      transcriptChanged: true,
      semanticContext: EMPTY_SEMANTIC_CONTEXT,
      now: 2_800,
    });
    expect(plan.semanticContext.hostTarget).toMatchObject({
      type: 'viewer',
      transcriptSequence: 7,
      dialogueId: 'identity-dialogue-2',
      turnId: 'identity-question-2',
      personaId: target.id,
    });
    expect(plan.slots).toHaveLength(1);
    expect(plan.slots[0]).toMatchObject({
      personaId: target.id,
      dialogueId: 'identity-dialogue-2',
    });
  });

  it('answers a broad host question with only two or three distinct viewers once', () => {
    const roster = createAudienceRoster(1_000, 'audience-question-roster');
    const director = new ConversationDirector('audience-question', roster);
    const input = {
      sequence: 1,
      desiredBatchSize: 12,
      currentViewers: 1_000,
      commentsPerMinute: 20,
      transcriptSegments: [
        {
          sequence: 10,
          text: 'чем вы сегодня занимаетесь?',
          startedAtMs: 100,
          endedAtMs: 1_000,
          language: 'ru' as const,
        },
      ],
      newTranscriptSequences: [10],
      transcriptChanged: true,
      semanticContext: EMPTY_SEMANTIC_CONTEXT,
      now: 1_100,
    } as const;
    const plan = director.plan(input);
    const answers = plan.slots.filter((slot) => slot.dialogueAction === 'answer_host');
    expect(answers.length).toBeGreaterThanOrEqual(2);
    expect(answers.length).toBeLessThanOrEqual(3);
    expect(new Set(answers.map(({ personaId }) => personaId)).size).toBe(answers.length);
    expect(
      answers.every(
        (slot) => slot.replyTarget?.type === 'host' && slot.replyTarget.transcriptSequence === 10,
      ),
    ).toBe(true);

    director.recordBatch(
      1,
      answers.map((slot, index) => ({
        slotId: slot.slotId,
        personaId: slot.personaId,
        text: `ответ зрителя ${index}`,
        language: slot.language,
        kind: slot.kind,
        ...(slot.dialogueId ? { dialogueId: slot.dialogueId } : {}),
        ...(slot.dialogueAction ? { dialogueAction: slot.dialogueAction } : {}),
        ...(slot.replyTarget ? { replyTarget: slot.replyTarget } : {}),
      })),
    );
    const firstAnswer = answers[0];
    if (!firstAnswer) throw new Error('Audience answer slot is missing.');
    director.recordRendered(
      {
        slotId: firstAnswer.slotId,
        personaId: firstAnswer.personaId,
        text: 'сейчас работаю',
        language: firstAnswer.language,
        kind: firstAnswer.kind,
        ...(firstAnswer.dialogueId ? { dialogueId: firstAnswer.dialogueId } : {}),
        ...(firstAnswer.dialogueAction ? { dialogueAction: firstAnswer.dialogueAction } : {}),
        ...(firstAnswer.replyTarget ? { replyTarget: firstAnswer.replyTarget } : {}),
      },
      2_000,
    );
    const repeated = director.plan({ ...input, sequence: 2, now: 2_100 });
    expect(repeated.slots.some((slot) => slot.dialogueAction === 'answer_host')).toBe(false);
  });

  it('bounds persona history and session novelty memory', () => {
    const persona = createAudienceRoster(100, 'bounded-memory').find(
      (candidate) => candidate.primaryLanguage === 'ru',
    );
    if (!persona) throw new Error('Persona fixture is missing.');
    const director = new ConversationDirector('bounded-memory', [persona]);
    for (let index = 0; index < 340; index += 1)
      director.recordRendered(
        {
          slotId: `slot-${index}`,
          personaId: persona.id,
          text: `уникальная реплика ${index}`,
          language: 'ru',
          kind: 'casual',
        },
        index * 1_000,
      );

    const plan = director.plan({
      sequence: 341,
      desiredBatchSize: 24,
      currentViewers: 100,
      commentsPerMinute: 6,
      transcriptSegments: [],
      newTranscriptSequences: [],
      transcriptChanged: false,
      semanticContext: EMPTY_SEMANTIC_CONTEXT,
      now: 341_000,
    });
    expect(plan.memories[0]?.recentMessages).toHaveLength(6);
    expect(plan.memories[0]?.recentMessages[0]).toBe('уникальная реплика 334');
    expect(plan.noveltyTexts).toHaveLength(300);
    expect(plan.noveltyTexts[0]).toBe('уникальная реплика 40');
  });
});

describe('comment scheduler', () => {
  it('emits generated comments in FIFO order without model-controlled delays', () => {
    let now = 0;
    const callbacks: Array<() => void> = [];
    const roster = createAudienceRoster(100, 'fifo');
    const emitted: string[] = [];
    const scheduler = new CommentScheduler({
      seed: 'fifo',
      roster,
      now: () => now,
      setTimer: (callback) => {
        callbacks.push(callback);
        return callbacks.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: vi.fn(),
      getCommentsPerMinute: () => 20,
      onLowBuffer: vi.fn(),
      onComment: (comment) => emitted.push(comment.text),
    });
    scheduler.start();
    scheduler.enqueue(
      ['первый', 'второй', 'третий'].map((text, index) => ({
        slotId: `slot-${index}`,
        personaId: roster[index]?.id ?? roster[0]?.id ?? '',
        text,
        language: 'ru' as const,
        kind: 'casual' as const,
      })),
    );
    for (let index = 0; index < 3; index += 1) {
      now += 1_000;
      callbacks.shift()?.();
    }
    expect(emitted).toEqual(['первый', 'второй', 'третий']);
    scheduler.stop();
  });

  it('pauses while hidden, resumes without a mass flush and removes its listener', () => {
    vi.useFakeTimers();
    let now = 0;
    const visibility = new VisibilityStub();
    const roster = createAudienceRoster(100, 'hidden');
    const emitted: string[] = [];
    const scheduler = new CommentScheduler({
      seed: 'hidden',
      roster,
      visibility,
      now: () => now,
      getCommentsPerMinute: () => 24,
      onLowBuffer: vi.fn(),
      onComment: (comment) => emitted.push(comment.text),
    });
    scheduler.enqueue(
      Array.from({ length: 8 }, (_, index) => ({
        slotId: `slot-${index}`,
        personaId: roster[index]?.id ?? roster[0]?.id ?? '',
        text: `message ${index}`,
        language: 'ru' as const,
        kind: 'casual' as const,
      })),
    );
    scheduler.start();
    expect(visibility.listeners.size).toBe(1);
    visibility.setHidden(true);
    now = 60_000;
    vi.advanceTimersByTime(60_000);
    expect(emitted).toHaveLength(0);
    visibility.setHidden(false);
    now += 2_000;
    vi.advanceTimersByTime(2_000);
    expect(emitted.length).toBeLessThanOrEqual(1);
    scheduler.stop();
    expect(visibility.listeners.size).toBe(0);
    expect(scheduler.queueSize).toBe(0);
  });

  it('bounds its queue and reports a time-based buffer', () => {
    const roster = createAudienceRoster(100, 'queue-bound');
    const onBufferChanged = vi.fn();
    const scheduler = new CommentScheduler({
      seed: 'queue-bound',
      roster,
      getCommentsPerMinute: () => 20,
      onLowBuffer: vi.fn(),
      onBufferChanged,
      onComment: vi.fn(),
    });
    const accepted = scheduler.enqueue(
      Array.from({ length: COMMENT_QUEUE_LIMIT + 20 }, (_, index) => ({
        slotId: `slot-${index}`,
        personaId: roster[index % roster.length]?.id ?? '',
        text: `message ${index}`,
        language: 'ru' as const,
        kind: 'casual' as const,
      })),
    );
    expect(accepted).toBe(COMMENT_QUEUE_LIMIT);
    expect(scheduler.queueSize).toBe(COMMENT_QUEUE_LIMIT);
    expect(scheduler.bufferSeconds).toBe(300);
    expect(onBufferChanged).toHaveBeenLastCalledWith(COMMENT_QUEUE_LIMIT, false);
    scheduler.stop();
    expect(scheduler.queueSize).toBe(0);
  });

  it('replaces stale context comments instead of resuming the buffered queue', () => {
    let now = 0;
    const callbacks: Array<() => void> = [];
    const roster = createAudienceRoster(100, 'priority-queue');
    const emitted: string[] = [];
    const scheduler = new CommentScheduler({
      seed: 'priority-queue',
      roster,
      now: () => now,
      setTimer: (callback) => {
        callbacks.push(callback);
        return callbacks.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: vi.fn(),
      getCommentsPerMinute: () => 20,
      onLowBuffer: vi.fn(),
      onComment: (comment) => emitted.push(comment.text),
    });
    const generated = (text: string, index: number) => ({
      slotId: `slot-${text}`,
      personaId: roster[index]?.id ?? roster[0]?.id ?? '',
      text,
      language: 'ru' as const,
      kind: 'casual' as const,
    });
    scheduler.enqueue(['old-1', 'old-2', 'old-3'].map(generated));
    scheduler.enqueue(['current-1', 'current-2'].map(generated), 'replace-context');
    scheduler.start();
    for (let index = 0; index < 2; index += 1) {
      now += 4_000;
      callbacks.shift()?.();
    }
    expect(emitted).toEqual(['current-1', 'current-2']);
    scheduler.stop();
  });

  it('clears pending comments and rendered reply dependencies on an immediate topic reset', () => {
    let now = 0;
    const callbacks: Array<() => void> = [];
    const roster = createAudienceRoster(100, 'topic-reset-queue');
    const emitted: string[] = [];
    const onBufferChanged = vi.fn();
    const scheduler = new CommentScheduler({
      seed: 'topic-reset-queue',
      roster,
      now: () => now,
      setTimer: (callback) => {
        callbacks.push(callback);
        return callbacks.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: vi.fn(),
      getCommentsPerMinute: () => 1_000_000,
      onLowBuffer: vi.fn(),
      onBufferChanged,
      onComment: ({ text }) => emitted.push(text),
    });
    const firstPersona = roster[0]?.id ?? '';
    const secondPersona = roster[1]?.id ?? firstPersona;
    scheduler.enqueue([
      {
        slotId: 'old-source',
        personaId: firstPersona,
        text: 'старый вопрос',
        language: 'ru',
        kind: 'casual',
        dialogueId: 'old-dialogue',
        dialogueAction: 'start_viewer',
      },
    ]);
    scheduler.start();
    const sourceTimer = callbacks.shift();
    expect(sourceTimer).toBeDefined();
    if (sourceTimer) {
      now += 1_000;
      sourceTimer();
    }
    expect(emitted).toEqual(['старый вопрос']);

    scheduler.resetTopic();
    expect(scheduler.queueSize).toBe(0);
    expect(onBufferChanged).toHaveBeenLastCalledWith(0, false);
    scheduler.enqueue([
      {
        slotId: 'orphaned-old-reply',
        personaId: secondPersona,
        text: 'ответ на старую тему',
        language: 'ru',
        kind: 'viewer_reply',
        dialogueId: 'old-dialogue',
        dialogueAction: 'reply_viewer',
        replyTarget: { type: 'viewer', personaId: firstPersona, turnId: 'old-source' },
      },
    ]);

    expect(scheduler.queueSize).toBe(0);
    expect(emitted).toEqual(['старый вопрос']);
    scheduler.stop();
  });

  it('delays a viewer reply from its exact rendered source without head-of-line blocking', () => {
    let now = 0;
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const roster = createAudienceRoster(100, 'reply-delay');
    const emitted: Array<{ text: string; appearedAt: number }> = [];
    const scheduler = new CommentScheduler({
      seed: 'reply-delay',
      roster,
      now: () => now,
      setTimer: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: vi.fn(),
      getCommentsPerMinute: () => 1_000_000,
      onLowBuffer: vi.fn(),
      onComment: ({ text, appearedAt }) => emitted.push({ text, appearedAt }),
    });
    const firstPersona = roster[0]?.id ?? '';
    const secondPersona = roster[1]?.id ?? firstPersona;
    const thirdPersona = roster[2]?.id ?? firstPersona;
    scheduler.enqueue([
      {
        slotId: 'conversation-reply',
        personaId: secondPersona,
        text: 'я смотрел, хороший',
        language: 'ru',
        kind: 'viewer_reply',
        dialogueId: 'dialogue_1',
        dialogueAction: 'reply_viewer',
        replyTarget: {
          type: 'viewer',
          personaId: firstPersona,
          turnId: 'conversation-source',
        },
      },
      {
        slotId: 'ordinary-comment',
        personaId: thirdPersona,
        text: 'звук норм',
        language: 'ru',
        kind: 'casual',
      },
      {
        slotId: 'conversation-source',
        personaId: firstPersona,
        text: 'кто смотрел этот фильм?',
        language: 'ru',
        kind: 'casual',
        dialogueId: 'dialogue_1',
        dialogueAction: 'start_viewer',
      },
    ]);
    scheduler.start();

    for (let index = 0; index < 3; index += 1) {
      const job = scheduled.shift();
      expect(job).toBeDefined();
      if (!job) break;
      now += job.delayMs;
      job.callback();
    }

    expect(emitted.map(({ text }) => text)).toEqual([
      'звук норм',
      'кто смотрел этот фильм?',
      'я смотрел, хороший',
    ]);
    const sourceAt = emitted[1]?.appearedAt ?? 0;
    const replyAt = emitted[2]?.appearedAt ?? 0;
    expect(replyAt - sourceAt).toBeGreaterThanOrEqual(
      BEHAVIOR_CALIBRATION.conversations.replyDelayMs[0],
    );
    expect(replyAt - sourceAt).toBeLessThanOrEqual(
      BEHAVIOR_CALIBRATION.conversations.replyDelayMs[1],
    );
    scheduler.stop();
  });

  it('preserves causal delays across multiple exact viewer-reply hops', () => {
    let now = 0;
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const roster = createAudienceRoster(100, 'multi-hop-delay');
    const emitted: Array<{ text: string; appearedAt: number }> = [];
    const scheduler = new CommentScheduler({
      seed: 'multi-hop-delay',
      roster,
      now: () => now,
      setTimer: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: vi.fn(),
      getCommentsPerMinute: () => 1_000_000,
      onLowBuffer: vi.fn(),
      onComment: ({ text, appearedAt }) => emitted.push({ text, appearedAt }),
    });
    const firstPersona = roster[0]?.id ?? '';
    const secondPersona = roster[1]?.id ?? firstPersona;
    const thirdPersona = roster[2]?.id ?? firstPersona;
    scheduler.enqueue([
      {
        slotId: 'turn-a',
        personaId: firstPersona,
        text: 'вы уже были здесь?',
        language: 'ru',
        kind: 'casual',
        dialogueId: 'dialogue_multi',
        dialogueAction: 'start_viewer',
      },
      {
        slotId: 'turn-b',
        personaId: secondPersona,
        text: 'я была вчера',
        language: 'ru',
        kind: 'viewer_reply',
        dialogueId: 'dialogue_multi',
        dialogueAction: 'reply_viewer',
        replyTarget: { type: 'viewer', personaId: firstPersona, turnId: 'turn-a' },
      },
      {
        slotId: 'turn-c',
        personaId: thirdPersona,
        text: 'тоже помню тот эфир',
        language: 'ru',
        kind: 'viewer_reply',
        dialogueId: 'dialogue_multi',
        dialogueAction: 'reply_viewer',
        replyTarget: { type: 'viewer', personaId: secondPersona, turnId: 'turn-b' },
      },
    ]);
    scheduler.start();

    for (let index = 0; index < 3; index += 1) {
      const job = scheduled.shift();
      expect(job).toBeDefined();
      if (!job) break;
      now += job.delayMs;
      job.callback();
    }

    expect(emitted.map(({ text }) => text)).toEqual([
      'вы уже были здесь?',
      'я была вчера',
      'тоже помню тот эфир',
    ]);
    for (let index = 1; index < emitted.length; index += 1) {
      const previous = emitted[index - 1]?.appearedAt ?? 0;
      const current = emitted[index]?.appearedAt ?? 0;
      expect(current - previous).toBeGreaterThanOrEqual(
        BEHAVIOR_CALIBRATION.conversations.replyDelayMs[0],
      );
      expect(current - previous).toBeLessThanOrEqual(
        BEHAVIOR_CALIBRATION.conversations.replyDelayMs[1],
      );
    }
    scheduler.stop();
  });

  it('drops orphan viewer replies without a timer loop and clears rendered turns on stop', () => {
    let now = 0;
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const roster = createAudienceRoster(100, 'orphan-reply');
    const emitted: string[] = [];
    const scheduler = new CommentScheduler({
      seed: 'orphan-reply',
      roster,
      now: () => now,
      setTimer: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: vi.fn(),
      getCommentsPerMinute: () => 1_000_000,
      onLowBuffer: vi.fn(),
      onComment: ({ text }) => emitted.push(text),
    });
    const firstPersona = roster[0]?.id ?? '';
    const secondPersona = roster[1]?.id ?? firstPersona;
    scheduler.enqueue([
      {
        slotId: 'rendered-before-stop',
        personaId: firstPersona,
        text: 'исходная реплика',
        language: 'ru',
        kind: 'casual',
        dialogueId: 'dialogue_old',
        dialogueAction: 'start_viewer',
      },
    ]);
    scheduler.start();
    const sourceJob = scheduled.shift();
    expect(sourceJob).toBeDefined();
    if (sourceJob) {
      now += sourceJob.delayMs;
      sourceJob.callback();
    }
    scheduler.stop();

    scheduler.enqueue([
      {
        slotId: 'orphan-after-stop',
        personaId: secondPersona,
        text: 'ответ без источника',
        language: 'ru',
        kind: 'viewer_reply',
        dialogueId: 'dialogue_old',
        dialogueAction: 'reply_viewer',
        replyTarget: {
          type: 'viewer',
          personaId: firstPersona,
          turnId: 'rendered-before-stop',
        },
      },
    ]);
    scheduler.start();

    expect(emitted).toEqual(['исходная реплика']);
    expect(scheduler.queueSize).toBe(0);
    expect(scheduled).toHaveLength(0);
    scheduler.stop();
  });
});

describe('runtime comment retention', () => {
  it('keeps a bounded immutable window during a long session', () => {
    useSessionStore.getState().clear();
    const firstSnapshot = useSessionStore.getState().comments;
    for (let index = 0; index < MAX_RUNTIME_COMMENTS * 5; index += 1) {
      const comment: LiveComment = {
        instanceId: `runtime-${index}`,
        templateId: 'casual',
        author: `viewer-${index}`,
        avatarSeed: `avatar-${index}`,
        text: `message ${index}`,
        badge: null,
        pinned: false,
        isHost: false,
        appearedAt: index,
      };
      useSessionStore.getState().addComment(comment);
    }
    const comments = useSessionStore.getState().comments;
    expect(firstSnapshot).toEqual([]);
    expect(comments).toHaveLength(MAX_RUNTIME_COMMENTS);
    expect(comments[0]?.instanceId).toBe(`runtime-${MAX_RUNTIME_COMMENTS * 4}`);
    expect(comments.at(-1)?.instanceId).toBe(`runtime-${MAX_RUNTIME_COMMENTS * 5 - 1}`);
    useSessionStore.getState().clear();
  });
});

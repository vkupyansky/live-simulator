import type {
  DialogueAction,
  DialogueReplyTarget,
  OpenDialogueContext,
} from '@/features/ai/contracts';
import type { GeneratedAudienceComment } from '@/features/comments/scheduler';

const MAX_TURN_TEXT_LENGTH = 800;
const MAX_HANDLED_AUDIENCE_SEQUENCES = 32;

type DialogueLanguage = 'ru' | 'en';

interface DialogueTurn {
  turnId: string;
  role: 'host' | 'viewer';
  personaId: string;
  text: string;
  replyToTurnId: string;
}

interface HostDialogue {
  dialogueId: string;
  personaId: string;
  language: DialogueLanguage;
  turns: DialogueTurn[];
  expiresAt: number;
  updatedAt: number;
}

export interface DialogueReservation {
  generationSequence: number;
  slotId: string;
  dialogueId: string;
  personaId: string;
  language: DialogueLanguage;
  action: DialogueAction;
  replyTarget?: DialogueReplyTarget;
  hostTurn?: {
    transcriptSequence: number;
    text: string;
  };
  audienceSequence?: number;
  allowReplacement?: boolean;
  now: number;
}

interface StoredReservation extends DialogueReservation {
  expiresAt: number;
}

export interface DialogueCoordinatorOptions {
  maximumActive: number;
  maximumTurns: number;
  lifetimeMs: number;
}

export type OpenDialogueStateContext = Omit<OpenDialogueContext, 'displayName' | 'username'>;

function boundedText(text: string): string {
  return [...text.normalize('NFKC').trim()].slice(0, MAX_TURN_TEXT_LENGTH).join('');
}

function isHostAction(action: DialogueAction): boolean {
  return (
    action === 'ask_host' ||
    action === 'answer_host' ||
    action === 'acknowledge_host' ||
    action === 'follow_up_host'
  );
}

export class DialogueCoordinator {
  private readonly dialogues = new Map<string, HostDialogue>();
  private readonly plannedBySequence = new Map<number, Map<string, StoredReservation>>();
  private readonly acceptedBySlotId = new Map<string, StoredReservation>();
  private readonly handledAudienceSequences = new Set<number>();
  private readonly handledAudienceSequenceOrder: number[] = [];

  constructor(private readonly options: DialogueCoordinatorOptions) {}

  reserve(reservation: DialogueReservation): boolean {
    this.prune(reservation.now);
    if (!isHostAction(reservation.action)) return false;
    if (this.findReservationBySlotId(reservation.slotId)) return false;

    const existing = this.dialogues.get(reservation.dialogueId);
    if (existing) {
      if (existing.personaId !== reservation.personaId) return false;
      if (existing.language !== reservation.language) return false;
      if (this.hasDialogueReservation(reservation.dialogueId)) return false;
      if (existing.turns.length + 2 > this.options.maximumTurns) return false;
      const target = reservation.replyTarget;
      const latestViewerTurn = [...existing.turns].reverse().find((turn) => turn.role === 'viewer');
      if (
        target?.type !== 'host' ||
        !latestViewerTurn ||
        reservation.hostTurn?.transcriptSequence !== target.transcriptSequence
      )
        return false;
      if (
        existing.turns.some(
          (turn) =>
            turn.role === 'host' &&
            turn.turnId === this.hostTurnId(existing.dialogueId, target.transcriptSequence),
        )
      )
        return false;
    } else {
      const pendingOpenings = this.pendingOpeningDialogueIds();
      if (pendingOpenings.has(reservation.dialogueId)) return false;
      if (pendingOpenings.size >= this.options.maximumActive) return false;
      if (
        this.dialogues.size + pendingOpenings.size >= this.options.maximumActive &&
        !reservation.allowReplacement
      )
        return false;
    }

    if (reservation.audienceSequence !== undefined) {
      if (this.handledAudienceSequences.has(reservation.audienceSequence)) return false;
      for (const pending of this.allReservations())
        if (
          pending.audienceSequence === reservation.audienceSequence &&
          pending.generationSequence !== reservation.generationSequence
        )
          return false;
    }

    const stored: StoredReservation = {
      ...reservation,
      expiresAt: reservation.now + this.options.lifetimeMs,
    };
    const sequenceReservations =
      this.plannedBySequence.get(reservation.generationSequence) ?? new Map();
    sequenceReservations.set(reservation.slotId, stored);
    this.plannedBySequence.set(reservation.generationSequence, sequenceReservations);
    return true;
  }

  recordBatch(sequence: number, comments: readonly GeneratedAudienceComment[]): void {
    const reservations = this.plannedBySequence.get(sequence);
    this.plannedBySequence.delete(sequence);
    if (!reservations) return;
    const acceptedSlotIds = new Set(comments.map(({ slotId }) => slotId));
    for (const [slotId, reservation] of reservations)
      if (acceptedSlotIds.has(slotId)) this.acceptedBySlotId.set(slotId, reservation);
  }

  recordFailure(sequence: number): void {
    this.plannedBySequence.delete(sequence);
  }

  recordRendered(comment: GeneratedAudienceComment, now: number): void {
    this.prune(now);
    const reservation = this.acceptedBySlotId.get(comment.slotId);
    this.acceptedBySlotId.delete(comment.slotId);
    if (!reservation) {
      if (comment.dialogueAction === 'ask_host' && comment.dialogueId)
        this.commitViewerQuestion(comment, now);
      return;
    }
    if (
      reservation.dialogueId !== comment.dialogueId ||
      reservation.personaId !== comment.personaId ||
      reservation.action !== comment.dialogueAction
    )
      return;

    if (reservation.audienceSequence !== undefined)
      this.markAudienceSequenceHandled(reservation.audienceSequence);

    if (reservation.action === 'ask_host') {
      this.commitViewerQuestion(comment, now);
      return;
    }

    const hostTurn = reservation.hostTurn;
    if (!hostTurn) return;
    let dialogue = this.dialogues.get(reservation.dialogueId);
    if (!dialogue) {
      this.makeRoomFor(reservation.dialogueId);
      dialogue = {
        dialogueId: reservation.dialogueId,
        personaId: reservation.personaId,
        language: reservation.language,
        turns: [],
        expiresAt: now + this.options.lifetimeMs,
        updatedAt: now,
      };
      this.dialogues.set(dialogue.dialogueId, dialogue);
    }
    if (dialogue.personaId !== comment.personaId || dialogue.language !== comment.language) return;

    const previousViewerTurn = [...dialogue.turns].reverse().find((turn) => turn.role === 'viewer');
    const hostTurnId = this.hostTurnId(dialogue.dialogueId, hostTurn.transcriptSequence);
    if (!dialogue.turns.some((turn) => turn.turnId === hostTurnId))
      dialogue.turns.push({
        turnId: hostTurnId,
        role: 'host',
        personaId: '',
        text: boundedText(hostTurn.text),
        replyToTurnId: previousViewerTurn?.turnId ?? '',
      });
    dialogue.turns.push({
      turnId: comment.slotId,
      role: 'viewer',
      personaId: comment.personaId,
      text: boundedText(comment.text),
      replyToTurnId: hostTurnId,
    });
    if (dialogue.turns.length > this.options.maximumTurns)
      dialogue.turns.splice(0, dialogue.turns.length - this.options.maximumTurns);
    dialogue.updatedAt = now;
    dialogue.expiresAt = now + this.options.lifetimeMs;
    if (
      reservation.action === 'acknowledge_host' ||
      dialogue.turns.length + 2 > this.options.maximumTurns
    )
      this.dialogues.delete(dialogue.dialogueId);
  }

  getOpenDialogues(now: number): OpenDialogueStateContext[] {
    this.prune(now);
    return [...this.dialogues.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, this.options.maximumActive)
      .map((dialogue) => ({
        dialogueId: dialogue.dialogueId,
        personaId: dialogue.personaId,
        language: dialogue.language,
        status: 'awaiting_host',
        turns: dialogue.turns.map((turn) => ({ ...turn })),
      }));
  }

  getActivePersonaIds(now: number): string[] {
    this.prune(now);
    return [...new Set([...this.dialogues.values()].map(({ personaId }) => personaId))];
  }

  isAudienceSequenceAvailable(sequence: number): boolean {
    if (this.handledAudienceSequences.has(sequence)) return false;
    for (const reservation of this.allReservations())
      if (reservation.audienceSequence === sequence) return false;
    return true;
  }

  canContinue(dialogueId: string, now: number): boolean {
    this.prune(now);
    const dialogue = this.dialogues.get(dialogueId);
    return Boolean(dialogue && dialogue.turns.length + 4 <= this.options.maximumTurns);
  }

  stop(): void {
    this.reset();
  }

  reset(): void {
    this.dialogues.clear();
    this.plannedBySequence.clear();
    this.acceptedBySlotId.clear();
    this.handledAudienceSequences.clear();
    this.handledAudienceSequenceOrder.length = 0;
  }

  get debugCounts(): Readonly<{
    dialogues: number;
    plannedReservations: number;
    acceptedReservations: number;
    handledAudienceSequences: number;
  }> {
    let plannedReservations = 0;
    for (const reservations of this.plannedBySequence.values())
      plannedReservations += reservations.size;
    return {
      dialogues: this.dialogues.size,
      plannedReservations,
      acceptedReservations: this.acceptedBySlotId.size,
      handledAudienceSequences: this.handledAudienceSequences.size,
    };
  }

  private commitViewerQuestion(comment: GeneratedAudienceComment, now: number): void {
    const dialogueId = comment.dialogueId;
    if (!dialogueId || !comment.dialogueAction || comment.dialogueAction !== 'ask_host') return;
    let dialogue = this.dialogues.get(dialogueId);
    if (!dialogue) {
      this.makeRoomFor(dialogueId);
      dialogue = {
        dialogueId,
        personaId: comment.personaId,
        language: comment.language,
        turns: [],
        expiresAt: now + this.options.lifetimeMs,
        updatedAt: now,
      };
      this.dialogues.set(dialogueId, dialogue);
    }
    if (dialogue.personaId !== comment.personaId || dialogue.language !== comment.language) return;
    if (dialogue.turns.some((turn) => turn.turnId === comment.slotId)) return;
    dialogue.turns.push({
      turnId: comment.slotId,
      role: 'viewer',
      personaId: comment.personaId,
      text: boundedText(comment.text),
      replyToTurnId: '',
    });
    dialogue.updatedAt = now;
    dialogue.expiresAt = now + this.options.lifetimeMs;
  }

  private makeRoomFor(dialogueId: string): void {
    if (this.dialogues.has(dialogueId) || this.dialogues.size < this.options.maximumActive) return;
    let oldest: HostDialogue | undefined;
    for (const dialogue of this.dialogues.values())
      if (!oldest || dialogue.updatedAt < oldest.updatedAt) oldest = dialogue;
    if (oldest) this.dialogues.delete(oldest.dialogueId);
  }

  private markAudienceSequenceHandled(sequence: number): void {
    if (this.handledAudienceSequences.has(sequence)) return;
    this.handledAudienceSequences.add(sequence);
    this.handledAudienceSequenceOrder.push(sequence);
    while (this.handledAudienceSequenceOrder.length > MAX_HANDLED_AUDIENCE_SEQUENCES) {
      const oldest = this.handledAudienceSequenceOrder.shift();
      if (oldest !== undefined) this.handledAudienceSequences.delete(oldest);
    }
  }

  private hostTurnId(dialogueId: string, transcriptSequence: number): string {
    return `${dialogueId}_host_${transcriptSequence}`;
  }

  private pendingOpeningDialogueIds(): Set<string> {
    const ids = new Set<string>();
    for (const reservation of this.allReservations())
      if (!this.dialogues.has(reservation.dialogueId)) ids.add(reservation.dialogueId);
    return ids;
  }

  private hasDialogueReservation(dialogueId: string): boolean {
    for (const reservation of this.allReservations())
      if (reservation.dialogueId === dialogueId) return true;
    return false;
  }

  private findReservationBySlotId(slotId: string): StoredReservation | undefined {
    const accepted = this.acceptedBySlotId.get(slotId);
    if (accepted) return accepted;
    for (const reservations of this.plannedBySequence.values()) {
      const planned = reservations.get(slotId);
      if (planned) return planned;
    }
    return undefined;
  }

  private *allReservations(): Iterable<StoredReservation> {
    for (const reservations of this.plannedBySequence.values()) yield* reservations.values();
    yield* this.acceptedBySlotId.values();
  }

  private prune(now: number): void {
    for (const [dialogueId, dialogue] of this.dialogues)
      if (dialogue.expiresAt <= now) this.dialogues.delete(dialogueId);
    for (const [sequence, reservations] of this.plannedBySequence) {
      for (const [slotId, reservation] of reservations)
        if (reservation.expiresAt <= now) reservations.delete(slotId);
      if (reservations.size === 0) this.plannedBySequence.delete(sequence);
    }
    for (const [slotId, reservation] of this.acceptedBySlotId)
      if (reservation.expiresAt <= now) this.acceptedBySlotId.delete(slotId);
  }
}

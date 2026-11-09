const DEFAULT_DEBOUNCE_MS = 280;
const MAX_TURN_CHARACTERS = 800;
const MAX_PENDING_TURNS = 8;
const MAX_PENDING_CHARACTERS = 2_400;

export interface FinalSpeechTurn {
  transcript: string;
  language?: string;
  durationMs?: number;
}

export interface SpeechTurnFinalizerOptions {
  onTurn(turn: FinalSpeechTurn): void;
  debounceMs?: number;
  setTimer?: typeof globalThis.setTimeout;
  clearTimer?: typeof globalThis.clearTimeout;
}

export class SpeechTurnFinalizer {
  private readonly debounceMs: number;
  private readonly setTimer: typeof globalThis.setTimeout;
  private readonly clearTimer: typeof globalThis.clearTimeout;
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private pending: FinalSpeechTurn[] = [];

  constructor(private readonly options: SpeechTurnFinalizerOptions) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.setTimer = options.setTimer ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimer = options.clearTimer ?? globalThis.clearTimeout.bind(globalThis);
  }

  push(turn: FinalSpeechTurn): void {
    const transcript = Array.from(turn.transcript.normalize('NFKC').replace(/\s+/g, ' ').trim())
      .slice(0, MAX_TURN_CHARACTERS)
      .join('');
    if (!transcript) return;
    const previous = this.pending.at(-1)?.transcript;
    if (previous === transcript) return;
    const pendingCharacters = this.pending.reduce(
      (total, candidate) => total + Array.from(candidate.transcript).length,
      0,
    );
    if (
      this.pending.length >= MAX_PENDING_TURNS ||
      pendingCharacters + Array.from(transcript).length > MAX_PENDING_CHARACTERS
    )
      this.flush();
    this.pending.push({ ...turn, transcript });
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.flush(), this.debounceMs);
  }

  flush(): void {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (this.pending.length === 0) return;
    const turns = this.pending;
    this.pending = [];
    const transcript = turns
      .map((turn) => turn.transcript)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const language = [...turns].reverse().find((turn) => turn.language)?.language;
    const durationMs = turns.reduce((sum, turn) => sum + (turn.durationMs ?? 0), 0);
    this.options.onTurn({
      transcript,
      ...(language ? { language } : {}),
      ...(durationMs > 0 ? { durationMs: Math.min(30_000, durationMs) } : {}),
    });
  }

  cancel(): void {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.pending = [];
  }
}

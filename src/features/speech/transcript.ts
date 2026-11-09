import type { TranscriptSegment } from '@/shared/types/broadcast';

export const TRANSCRIPT_WINDOW_MS = 90_000;
export const TRANSCRIPT_MAX_CHARACTERS = 2_400;
export const TRANSCRIPT_MAX_SEGMENTS = 18;

const NOISE_ONLY = /^(?:[а-яa-z]*[эеeаaуuмmхh]+[а-яa-z]*|шум|тишина|музыка|аплодисменты)$/iu;

export function normalizeTranscript(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/\[(?:music|noise|silence|музыка|шум|тишина)[\s\S]*?\]/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
  if (normalized.length < 2 || NOISE_ONLY.test(normalized)) return '';
  return normalized;
}

export class TranscriptWindow {
  private segments: TranscriptSegment[] = [];

  add(segment: TranscriptSegment, now: number): boolean {
    const text = normalizeTranscript(segment.text);
    if (!text || this.segments.some((candidate) => candidate.sequence === segment.sequence))
      return false;
    this.segments.push({ ...segment, text });
    this.prune(now);
    return true;
  }

  prune(now: number): void {
    this.segments = this.segments
      .filter((segment) => segment.endedAtMs >= now - TRANSCRIPT_WINDOW_MS)
      .slice(-TRANSCRIPT_MAX_SEGMENTS);
    while (
      this.segments.reduce((sum, segment) => sum + Array.from(segment.text).length, 0) >
      TRANSCRIPT_MAX_CHARACTERS
    )
      this.segments.shift();
  }

  snapshot(): TranscriptSegment[] {
    return this.segments.map((segment) => ({ ...segment }));
  }

  clear(): void {
    this.segments = [];
  }
}

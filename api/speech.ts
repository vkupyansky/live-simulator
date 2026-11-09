import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import WebSocket from 'ws';
import type { ApiConfig } from './config.js';
import { createDeepgramStreamingAdapter } from './deepgram.js';
import { isSameHttpOrigin } from './origin.js';

export interface SpeechStreamOptions {
  sampleRate: number;
}

export interface SpeechTranscript {
  transcript: string;
  language?: string;
  durationMs?: number;
}

export interface SpeechStreamHandlers {
  ready(): void;
  transcript(result: SpeechTranscript): void;
  error(error: { code: string; retryable: boolean }): void;
  closed(): void;
}

export interface SpeechStream {
  send(audio: Buffer): void;
  close(): void;
}

export interface StreamingSpeechAdapter {
  readonly provider: string;
  connect(options: SpeechStreamOptions, handlers: SpeechStreamHandlers): SpeechStream;
}

export async function probeStreamingSpeech(
  adapter: StreamingSpeechAdapter,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let stream: SpeechStream | null = null;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      stream?.close();
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error('Streaming speech probe timed out'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      stream = adapter.connect(
        { sampleRate: 48_000 },
        {
          ready: () => finish(),
          transcript: () => undefined,
          error: ({ code }) => finish(new Error(code)),
          closed: () => finish(new Error('Streaming speech connection closed during probe')),
        },
      );
      if (signal.aborted) abort();
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Streaming speech probe failed'));
    }
  });
}

const querySchema = z
  .object({
    sessionId: z
      .string()
      .min(8)
      .max(120)
      .regex(/^[A-Za-z0-9_-]+$/),
    sampleRate: z.coerce
      .number()
      .int()
      .refine((value) => [8_000, 16_000, 24_000, 44_100, 48_000].includes(value)),
  })
  .strict();

const MAX_ACTIVE_STREAMS = 16;
const MAX_AUDIO_CHUNK_BYTES = 32_768;

function sendJson(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function transcriptMetrics(result: SpeechTranscript): {
  characterCount: number;
  wordCount: number;
  cyrillicPercent: number;
} {
  const characters = Array.from(result.transcript);
  const letters = characters.filter((character) => /\p{L}/u.test(character));
  const cyrillic = letters.filter((character) => /\p{Script=Cyrillic}/u.test(character));
  return {
    characterCount: characters.length,
    wordCount: result.transcript.split(/\s+/u).filter(Boolean).length,
    cyrillicPercent:
      letters.length === 0 ? 0 : Math.round((cyrillic.length / letters.length) * 100),
  };
}

export function registerSpeechStreaming(
  app: FastifyInstance,
  config: ApiConfig,
  adapter: StreamingSpeechAdapter = createDeepgramStreamingAdapter(config),
): void {
  let activeStreams = 0;

  app.get('/api/v1/transcriptions/stream', { websocket: true }, (socket, request) => {
    if (!isSameHttpOrigin(request.headers.origin, request.headers.host)) {
      socket.close(1008, 'origin-rejected');
      return;
    }
    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      socket.close(1008, 'invalid-request');
      return;
    }
    if (activeStreams >= MAX_ACTIVE_STREAMS) {
      sendJson(socket, { type: 'error', code: 'SPEECH_CAPACITY_REACHED', retryable: true });
      socket.close(1013, 'capacity-reached');
      return;
    }

    activeStreams += 1;
    let released = false;
    let upstream: SpeechStream | null = null;
    let turnSequence = 0;
    const release = (): void => {
      if (released) return;
      released = true;
      activeStreams -= 1;
    };

    try {
      upstream = adapter.connect(
        { sampleRate: query.data.sampleRate },
        {
          ready: () => {
            request.log.info({
              event: 'speech_stream_ready',
              requestId: request.id,
              provider: adapter.provider,
              model: config.deepgramModel,
              sampleRate: query.data.sampleRate,
            });
            sendJson(socket, { type: 'ready' });
          },
          transcript: (result) => {
            turnSequence += 1;
            request.log.info({
              event: 'speech_turn_recognized',
              requestId: request.id,
              provider: adapter.provider,
              model: config.deepgramModel,
              turnSequence,
              detectedLanguage: result.language ?? 'unknown',
              durationMs: result.durationMs ?? 0,
              ...transcriptMetrics(result),
            });
            sendJson(socket, { type: 'transcript', ...result });
          },
          error: (error) => {
            request.log.warn({
              event: 'speech_stream_failed',
              requestId: request.id,
              provider: adapter.provider,
              model: config.deepgramModel,
              code: error.code,
              retryable: error.retryable,
            });
            sendJson(socket, { type: 'error', ...error });
          },
          closed: () => {
            request.log.info({
              event: 'speech_stream_closed',
              requestId: request.id,
              provider: adapter.provider,
              model: config.deepgramModel,
              recognizedTurns: turnSequence,
            });
            if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'upstream-closed');
            release();
          },
        },
      );
    } catch {
      release();
      request.log.warn({
        event: 'speech_stream_connect_failed',
        requestId: request.id,
        provider: adapter.provider,
        model: config.deepgramModel,
      });
      sendJson(socket, {
        type: 'error',
        code: 'SPEECH_UPSTREAM_UNAVAILABLE',
        retryable: true,
      });
      socket.close(1011, 'upstream-connect-failed');
      return;
    }

    socket.on('message', (data, isBinary) => {
      const audio = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (!isBinary || audio.byteLength === 0 || audio.byteLength > MAX_AUDIO_CHUNK_BYTES) {
        socket.close(1003, 'binary-audio-required');
        return;
      }
      upstream?.send(audio);
    });
    socket.on('close', () => {
      upstream?.close();
      upstream = null;
      release();
    });
    socket.on('error', () => {
      upstream?.close();
    });
  });
}

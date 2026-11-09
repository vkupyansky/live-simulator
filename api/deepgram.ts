import WebSocket, { type RawData } from 'ws';
import type { ApiConfig } from './config.js';
import type {
  SpeechStream,
  SpeechStreamHandlers,
  SpeechStreamOptions,
  StreamingSpeechAdapter,
} from './speech.js';

interface FluxMessage {
  type?: unknown;
  event?: unknown;
  transcript?: unknown;
  audio_window_start?: unknown;
  audio_window_end?: unknown;
  language?: unknown;
  languages?: unknown;
}

const MAX_UPSTREAM_BUFFERED_AUDIO_BYTES = 256 * 1024;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstLanguage(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length >= 2 && value.length <= 20) return value;
    if (Array.isArray(value)) {
      const language = value.find((item) => typeof item === 'string');
      if (typeof language === 'string' && language.length >= 2 && language.length <= 20)
        return language;
    }
  }
  return undefined;
}

function decodeJson(data: RawData): Record<string, unknown> | null {
  try {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : Buffer.from(data as ArrayBuffer).toString('utf8');
    if (text.length > 256_000) return null;
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function deepgramStreamUrl(config: ApiConfig, options: SpeechStreamOptions): string {
  const url = new URL('/v2/listen', config.deepgramStreamingBaseUrl);
  url.searchParams.set('model', config.deepgramModel);
  url.searchParams.set('encoding', 'linear16');
  url.searchParams.set('sample_rate', String(options.sampleRate));
  url.searchParams.set('language_hint', config.deepgramLanguageHint);
  url.searchParams.set('eot_threshold', String(config.deepgramEotThreshold));
  url.searchParams.set('eot_timeout_ms', String(config.deepgramEotTimeoutMs));
  return url.toString();
}

function createFluxMessageHandler(handlers: SpeechStreamHandlers) {
  return (message: FluxMessage): void => {
    if (message.type !== 'TurnInfo' || message.event !== 'EndOfTurn') return;
    const transcript = typeof message.transcript === 'string' ? message.transcript.trim() : '';
    if (!transcript) return;
    const start = finiteNumber(message.audio_window_start);
    const end = finiteNumber(message.audio_window_end);
    const language = firstLanguage(message.language, message.languages);
    handlers.transcript({
      transcript,
      ...(language ? { language } : {}),
      ...(start === undefined || end === undefined
        ? {}
        : { durationMs: Math.max(0, Math.round((end - start) * 1000)) }),
    });
  };
}

export function createDeepgramStreamingAdapter(config: ApiConfig): StreamingSpeechAdapter {
  return {
    provider: 'deepgram',
    connect(options, handlers): SpeechStream {
      const upstream = new WebSocket(deepgramStreamUrl(config, options), {
        headers: { Authorization: `Token ${config.deepgramApiKey}` },
        handshakeTimeout: 10_000,
        maxPayload: 256_000,
        perMessageDeflate: false,
      });
      const handleMessage = createFluxMessageHandler(handlers);
      let ready = false;
      let reportedError = false;

      upstream.on('open', () => {
        ready = true;
        handlers.ready();
      });
      upstream.on('message', (data) => {
        const message = decodeJson(data);
        if (message) handleMessage(message);
      });
      upstream.on('unexpected-response', (_request, response) => {
        reportedError = true;
        handlers.error({
          code:
            response.statusCode === 401 || response.statusCode === 403
              ? 'SPEECH_AUTH_FAILED'
              : 'SPEECH_UPSTREAM_REJECTED',
          retryable: response.statusCode !== 401 && response.statusCode !== 403,
        });
      });
      upstream.on('error', () => {
        if (reportedError) return;
        reportedError = true;
        handlers.error({ code: 'SPEECH_UPSTREAM_UNAVAILABLE', retryable: true });
      });
      upstream.on('close', (code) => {
        if (!reportedError && code !== 1000) {
          reportedError = true;
          handlers.error({ code: 'SPEECH_UPSTREAM_CLOSED', retryable: code !== 1008 });
        }
        handlers.closed();
      });

      return {
        send(audio) {
          if (
            ready &&
            upstream.readyState === WebSocket.OPEN &&
            upstream.bufferedAmount <= MAX_UPSTREAM_BUFFERED_AUDIO_BYTES
          )
            upstream.send(audio, { binary: true });
        },
        close() {
          if (upstream.readyState === WebSocket.OPEN) upstream.close(1000, 'client-closed');
          else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
        },
      };
    },
  };
}

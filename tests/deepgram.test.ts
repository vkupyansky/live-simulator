import type { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../api/config.js';
import { createDeepgramStreamingAdapter, deepgramStreamUrl } from '../api/deepgram.js';

interface MockSocket extends EventEmitter {
  url: string;
  options: { headers?: Record<string, string> };
  readyState: number;
  bufferedAmount: number;
  sent: Array<{ data: Buffer; options: { binary?: boolean } }>;
  terminated: boolean;
}

const socketState = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock('ws', async () => {
  const { EventEmitter: NodeEventEmitter } = await import('node:events');
  class MockWebSocket extends NodeEventEmitter {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    readonly url: string;
    readonly options: { headers?: Record<string, string> };
    readyState = MockWebSocket.CONNECTING;
    bufferedAmount = 0;
    readonly sent: Array<{ data: Buffer; options: { binary?: boolean } }> = [];
    terminated = false;

    constructor(url: string, options: { headers?: Record<string, string> }) {
      super();
      this.url = url;
      this.options = options;
      socketState.instances.push(this);
    }

    send(data: Buffer, options: { binary?: boolean }): void {
      this.sent.push({ data, options });
    }

    close(code = 1000): void {
      this.readyState = 3;
      this.emit('close', code);
    }

    terminate(): void {
      this.terminated = true;
      this.readyState = 3;
    }
  }
  return { default: MockWebSocket };
});

const config: ApiConfig = {
  appDomain: 'live.example.test',
  mistralApiKey: 'mistral-unit-test-secret',
  mistralApiBaseUrl: 'https://api.mistral.test',
  mistralContextModel: 'mistral-medium-3-5',
  mistralCommentModel: 'mistral-small-2603',
  deepgramApiKey: 'deepgram-unit-test-secret',
  deepgramStreamingBaseUrl: 'wss://api.deepgram.test',
  deepgramModel: 'flux-general-multi',
  deepgramLanguageHint: 'ru',
  deepgramEotThreshold: 0.7,
  deepgramEotTimeoutMs: 1_200,
};

beforeEach(() => {
  socketState.instances.length = 0;
});

describe('Deepgram Flux streaming adapter', () => {
  it('builds the one supported v2 Flux URL from required configuration', () => {
    const url = new URL(deepgramStreamUrl(config, { sampleRate: 48_000 }));
    expect(url.protocol).toBe('wss:');
    expect(url.pathname).toBe('/v2/listen');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model: 'flux-general-multi',
      encoding: 'linear16',
      sample_rate: '48000',
      language_hint: 'ru',
      eot_threshold: '0.7',
      eot_timeout_ms: '1200',
    });
  });

  it('authenticates, forwards PCM only after open and emits one confirmed EndOfTurn transcript', () => {
    const ready = vi.fn();
    const transcript = vi.fn();
    const error = vi.fn();
    const closed = vi.fn();
    const adapter = createDeepgramStreamingAdapter(config);
    const stream = adapter.connect({ sampleRate: 48_000 }, { ready, transcript, error, closed });
    const socket = socketState.instances[0] as MockSocket;

    const beforeOpen = Buffer.from([1, 2]);
    stream.send(beforeOpen);
    expect(socket.sent).toHaveLength(0);
    expect(socket.options.headers).toEqual({ Authorization: `Token ${config.deepgramApiKey}` });

    socket.readyState = 1;
    socket.emit('open');
    expect(ready).toHaveBeenCalledOnce();
    const audio = Buffer.from([3, 4, 5, 6]);
    stream.send(audio);
    expect(socket.sent).toEqual([{ data: audio, options: { binary: true } }]);
    socket.bufferedAmount = 300 * 1024;
    stream.send(Buffer.from([7, 8]));
    expect(socket.sent).toHaveLength(1);

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'TurnInfo',
          event: 'Update',
          transcript: 'промежуточный текст',
        }),
      ),
    );
    expect(transcript).not.toHaveBeenCalled();

    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'TurnInfo',
          event: 'EndOfTurn',
          transcript: '  давайте поговорим о путешествиях  ',
          audio_window_start: 1.25,
          audio_window_end: 3.05,
          languages: ['ru'],
        }),
      ),
    );
    expect(transcript).toHaveBeenCalledOnce();
    expect(transcript).toHaveBeenCalledWith({
      transcript: 'давайте поговорим о путешествиях',
      language: 'ru',
      durationMs: 1_800,
    });
    expect(error).not.toHaveBeenCalled();

    stream.close();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('ignores malformed/empty events and maps authorization rejection as non-retryable', () => {
    const transcript = vi.fn();
    const error = vi.fn();
    const adapter = createDeepgramStreamingAdapter(config);
    adapter.connect({ sampleRate: 16_000 }, { ready: vi.fn(), transcript, error, closed: vi.fn() });
    const socket = socketState.instances[0] as MockSocket;
    socket.emit('message', Buffer.from('{'));
    socket.emit(
      'message',
      Buffer.from(JSON.stringify({ type: 'TurnInfo', event: 'EndOfTurn', transcript: '   ' })),
    );
    expect(transcript).not.toHaveBeenCalled();

    socket.emit('unexpected-response', {}, { statusCode: 401 });
    expect(error).toHaveBeenCalledWith({ code: 'SPEECH_AUTH_FAILED', retryable: false });
  });
});

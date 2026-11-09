import { createApi } from './app.js';
import { readApiConfig, validateModelCapabilities } from './config.js';
import { createDeepgramStreamingAdapter } from './deepgram.js';
import { AiUpstreamError } from './gateway.js';
import { createMistralGateway } from './mistral.js';
import { probeStreamingSpeech } from './speech.js';

const API_PORT = 3000;
const CAPABILITY_PROBE_TIMEOUT_MS = 20_000;
const CAPABILITY_RATE_LIMIT_RETRY_MAX_MS = 60_000;

const config = readApiConfig(process.env);
const gateway = createMistralGateway(config);
const speechAdapter = createDeepgramStreamingAdapter(config);

async function probeModels(): Promise<void> {
  try {
    validateModelCapabilities(
      await gateway.probeCapabilities(AbortSignal.timeout(CAPABILITY_PROBE_TIMEOUT_MS)),
    );
  } catch (error) {
    if (!(error instanceof AiUpstreamError) || error.code !== 'MISTRAL_RATE_LIMITED') throw error;
    const retryAfterMs = Math.min(
      CAPABILITY_RATE_LIMIT_RETRY_MAX_MS,
      Math.max(1_000, error.retryAfterMs ?? 10_000),
    );
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    validateModelCapabilities(
      await gateway.probeCapabilities(AbortSignal.timeout(CAPABILITY_PROBE_TIMEOUT_MS)),
    );
  }
}

try {
  await Promise.all([
    probeModels(),
    probeStreamingSpeech(speechAdapter, AbortSignal.timeout(CAPABILITY_PROBE_TIMEOUT_MS)),
  ]);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      level: 'error',
      event: 'startup_capability_probe_failed',
      error: error instanceof Error ? error.message : 'unknown',
    })}\n`,
  );
  throw new Error('Required AI or speech capability is unavailable at startup', { cause: error });
}

const app = await createApi({ config, gateway, logger: true });

const shutdown = async () => {
  await app.close();
  process.exit(0);
};

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

try {
  await app.listen({ host: '0.0.0.0', port: API_PORT });
} catch (error) {
  app.log.error({
    event: 'api_start_failed',
    error: error instanceof Error ? error.message : 'unknown',
  });
  process.exit(1);
}

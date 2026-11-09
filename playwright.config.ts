import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) throw new Error('E2E_BASE_URL is required');
const requestedBrowser = process.env.E2E_BROWSER;
if (requestedBrowser && requestedBrowser !== 'webkit' && requestedBrowser !== 'chromium')
  throw new Error('E2E_BROWSER must be webkit or chromium');
const browserName: 'webkit' | 'chromium' = requestedBrowser === 'chromium' ? 'chromium' : 'webkit';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '/artifacts/test-results',
  timeout: 45_000,
  expect: { timeout: 8_000, toHaveScreenshot: { maxDiffPixelRatio: 0.015 } },
  fullyParallel: false,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '/artifacts/playwright-report' }]],
  use: {
    ...devices['iPhone 14 Pro Max'],
    baseURL,
    viewport: { width: 430, height: 932 },
    ignoreHTTPSErrors: false,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: `${browserName}-iphone`, use: { browserName } }],
});

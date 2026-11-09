import { expect, test, type Page, type TestInfo } from '@playwright/test';

const AVATAR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAARGVYSWZNTQAqAAAACAABh2kABAAAAAEAAAAaAAAAAAADoAEAAwAAAAEAAQAAoAIABAAAAAEAAAAEoAMABAAAAAEAAAAEAAAAAMVs/gIAAAHLaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJYTVAgQ29yZSA2LjAuMCI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOmV4aWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vZXhpZi8xLjAvIj4KICAgICAgICAgPGV4aWY6Q29sb3JTcGFjZT4xPC9leGlmOkNvbG9yU3BhY2U+CiAgICAgICAgIDxleGlmOlBpeGVsWERpbWVuc2lvbj4xODA8L2V4aWY6UGl4ZWxYRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpQaXhlbFlEaW1lbnNpb24+MTgwPC9leGlmOlBpeGVsWURpbWVuc2lvbj4KICAgICAgPC9yZGY6RGVzY3JpcHRpb24+CiAgIDwvcmRmOlJERj4KPC94OnhtcG1ldGE+ClL4d+wAAABNSURBVAgdY5STU7b+/evv9r8/vjJ8//LFk+nLly+7LKwteSvyC3jZOTh2MX369J6BX0yI4dztGwxvv31iYGBhYbFm4+D+xMrG8QnEBgBpXxvdRzICLwAAAABJRU5ErkJggg==',
  'base64',
);

// One black 16 x 16 H.264 Baseline frame in a fast-start ISO BMFF container.
// Keeping a valid file here makes WebKit exercise media metadata/object URL cleanup
// instead of accepting arbitrary bytes that merely carry a video/mp4 MIME type.
const LOCAL_VIDEO_MP4 = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMPbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAjl0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAGxbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABXG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAARxzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAe/+EAFmdCwB7ZHsBEAAADAAQAAAMACDxYuSABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABQwAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAAKGAAAAAQAAABRzdGNvAAAAAAAAAAEAAAM/AAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDIAAAAIZnJlZQAAAo5tZGF0AAACcAYF//9s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA5liIQFf///D0UAAULfgA==',
  'base64',
);

async function openSetup(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByLabel('Display name')).toBeVisible();
}

async function configureVideoBroadcast(
  page: Page,
  options: { speech: boolean } = { speech: false },
): Promise<void> {
  await page.getByLabel('Display name').fill('Studio Host');
  await page.getByLabel('Username').fill('@studio.host');
  await page.locator('input[accept="image/jpeg,image/png,image/webp"]').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: AVATAR_PNG,
  });
  await page.locator('input[accept="video/*"]').setInputFiles({
    name: 'local-video.mp4',
    mimeType: 'video/mp4',
    buffer: LOCAL_VIDEO_MP4,
  });
  await expect(page.getByText('local-video.mp4')).toBeVisible();
  await page.getByRole('textbox', { name: 'Целевое количество зрителей' }).fill('500');
  await page.getByRole('button', { name: 'Обычная' }).click();
  const speech = page.getByRole('switch', { name: 'Учитывать речь' });
  if (options.speech) await speech.click();
  await expect(speech).toHaveAttribute('aria-checked', String(options.speech));
  await expect(page.getByRole('button', { name: 'Начать эфир' })).toBeEnabled();
}

async function configureCameraBroadcast(page: Page): Promise<void> {
  await page.getByLabel('Display name').fill('Studio Host');
  await page.getByLabel('Username').fill('@studio.host');
  await page.locator('input[accept="image/jpeg,image/png,image/webp"]').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: AVATAR_PNG,
  });
  await page.getByRole('button', { name: 'Камера' }).click();
  const viewerTarget = page.getByRole('textbox', {
    name: 'Целевое количество зрителей',
  });
  await viewerTarget.fill('1000');
  await page.getByRole('button', { name: 'Обычная' }).click();
  await expect(viewerTarget).toHaveValue('1000');
  await expect(page.getByRole('button', { name: 'Начать эфир' })).toBeEnabled();
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const image = await page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
  expect(image.byteLength).toBeGreaterThan(10_000);
}

async function verifyCommentFeedScroll(page: Page): Promise<void> {
  const feed = page.getByLabel('Последние комментарии');
  await feed.evaluate((element) => {
    const overflow = document.createElement('div');
    overflow.dataset.e2eScrollFixture = 'true';
    overflow.style.flex = '0 0 900px';
    overflow.setAttribute('aria-hidden', 'true');
    element.append(overflow);
    element.scrollTop = element.scrollHeight;
  });

  const geometry = await feed.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const styles = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      overflowY: styles.overflowY,
      touchAction: styles.touchAction,
      pointerReachable: Boolean(hit?.closest('.comment-feed') === element),
    };
  });
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  expect(geometry.scrollTop).toBeGreaterThan(0);
  expect(geometry.overflowY).toBe('auto');
  expect(geometry.touchAction).toContain('pan-y');
  expect(geometry.pointerReachable).toBe(true);

  await feed.evaluate((element) => element.scrollBy({ top: -300, behavior: 'auto' }));
  await expect
    .poll(() => feed.evaluate((element) => element.scrollTop), { timeout: 2_000 })
    .toBeLessThan(geometry.scrollTop);
  const upwardPosition = await feed.evaluate((element) => element.scrollTop);
  await feed.evaluate((element) => element.scrollBy({ top: 300, behavior: 'auto' }));
  await expect
    .poll(() => feed.evaluate((element) => element.scrollTop), { timeout: 2_000 })
    .toBeGreaterThan(upwardPosition);

  await feed.evaluate((element) => {
    element.querySelector('[data-e2e-scroll-fixture]')?.remove();
  });
}

test.describe('production PWA', () => {
  test('fits the 430 × 932 setup in one safe viewport', async ({ page }) => {
    await openSetup(page);
    const layout = await page.evaluate(() => {
      const avatar = document.querySelector('.setup-avatar')?.getBoundingClientRect();
      const displayName = document
        .querySelector<HTMLInputElement>('input[aria-label="Display name"]')
        ?.getBoundingClientRect();
      const username = document
        .querySelector<HTMLInputElement>('input[aria-label="Username"]')
        ?.getBoundingClientRect();
      const controlsElement = document.querySelector('.setup-controls');
      const controls = controlsElement?.getBoundingClientRect();
      const startElement = document.querySelector('.setup-start');
      const start = startElement?.getBoundingClientRect();
      const speechLabel = [...document.querySelectorAll('.setup-row > span')].find(
        (label) => label.textContent === 'Учитывать речь',
      );
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        avatarBottom: avatar?.bottom ?? Number.POSITIVE_INFINITY,
        displayTop: displayName?.top ?? Number.NEGATIVE_INFINITY,
        displayBottom: displayName?.bottom ?? Number.POSITIVE_INFINITY,
        usernameTop: username?.top ?? Number.NEGATIVE_INFINITY,
        usernameBottom: username?.bottom ?? Number.POSITIVE_INFINITY,
        controlsTop: controls?.top ?? Number.NEGATIVE_INFINITY,
        controlsBottom: controls?.bottom ?? Number.POSITIVE_INFINITY,
        startTop: start?.top ?? Number.NEGATIVE_INFINITY,
        startBottom: start?.bottom ?? Number.POSITIVE_INFINITY,
        speechWhiteSpace: speechLabel ? getComputedStyle(speechLabel).whiteSpace : '',
        speechFits: speechLabel ? speechLabel.scrollWidth <= speechLabel.clientWidth : false,
        startFollowsSettings: Boolean(
          controlsElement &&
          startElement &&
          controlsElement.compareDocumentPosition(startElement) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        hasChoose: document.body.textContent?.includes('Выбрать') ?? true,
      };
    });
    expect(layout).toMatchObject({ width: 430, height: 932, scrollWidth: 430, scrollHeight: 932 });
    expect(layout.avatarBottom).toBeLessThanOrEqual(layout.displayTop);
    expect(layout.displayBottom).toBeLessThanOrEqual(layout.usernameTop);
    expect(layout.usernameBottom).toBeLessThanOrEqual(layout.controlsTop);
    expect(layout.controlsBottom).toBeLessThanOrEqual(layout.startTop);
    expect(layout.startBottom).toBeLessThanOrEqual(layout.height - 8);
    expect(layout.speechWhiteSpace).toBe('nowrap');
    expect(layout.speechFits).toBe(true);
    expect(layout.startFollowsSettings).toBe(true);
    expect(layout.hasChoose).toBe(false);
    await expect(page.getByRole('textbox', { name: 'Целевое количество зрителей' })).toBeVisible();
    await expect(page).toHaveScreenshot('broadcast-setup-main.png', { animations: 'disabled' });
  });

  test('keeps identity visible and uses inner scrolling while the keyboard is open', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.addInitScript(() => {
      class TestVisualViewport extends EventTarget {
        width = 430;
        height = 932;
        offsetLeft = 0;
        offsetTop = 0;
        pageLeft = 0;
        pageTop = 0;
        scale = 1;
      }
      const viewport = new TestVisualViewport();
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: viewport,
      });
      Object.defineProperty(window, '__setTestVisualViewportHeight', {
        configurable: true,
        value: (height: number) => {
          viewport.height = height;
          viewport.dispatchEvent(new Event('resize'));
        },
      });
    });
    await openSetup(page);
    const main = page.locator('main.broadcast-setup');
    const displayName = page.getByLabel('Display name');
    const username = page.getByLabel('Username');
    await displayName.focus();
    await page.evaluate(() =>
      (
        window as typeof window & { __setTestVisualViewportHeight(height: number): void }
      ).__setTestVisualViewportHeight(320),
    );
    await expect(main).toHaveAttribute('data-keyboard-open', 'true');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const field = document.querySelector<HTMLInputElement>(
            'input[aria-label="Display name"]',
          );
          const settings = document.querySelector('.setup-controls');
          const start = document.querySelector('.setup-start-zone');
          const root = document.querySelector<HTMLElement>('main.broadcast-setup');
          if (!field || !settings || !start || !root) return false;
          const fieldRect = field.getBoundingClientRect();
          const settingsRect = settings.getBoundingClientRect();
          const startRect = start.getBoundingClientRect();
          return (
            fieldRect.top >= 0 &&
            fieldRect.bottom <= 320 &&
            settingsRect.top >= fieldRect.bottom &&
            startRect.top >= settingsRect.bottom &&
            root.scrollHeight > root.clientHeight &&
            getComputedStyle(root).overflowY === 'auto'
          );
        }),
      )
      .toBe(true);

    await username.focus();
    await expect
      .poll(() =>
        username.evaluate((field) => {
          const rect = field.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= 320;
        }),
      )
      .toBe(true);

    await username.blur();
    await page.evaluate(() =>
      (
        window as typeof window & { __setTestVisualViewportHeight(height: number): void }
      ).__setTestVisualViewportHeight(932),
    );
    await expect(main).toHaveAttribute('data-keyboard-open', 'false');
    expect(
      await main.evaluate((element) => ({
        scrollTop: element.scrollTop,
        overflowY: getComputedStyle(element).overflowY,
      })),
    ).toEqual({ scrollTop: 0, overflowY: 'hidden' });
    expect(consoleErrors).toEqual([]);
  });

  test('switches sources without requesting permission before Start', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: MediaStreamConstraints[] = [];
      Object.defineProperty(window, '__mediaCalls', { value: calls, configurable: true });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async (constraints: MediaStreamConstraints) => {
            calls.push(constraints);
            return new MediaStream();
          },
        },
      });
    });
    await openSetup(page);
    await page.getByRole('button', { name: 'Камера' }).click();
    expect(
      await page.evaluate(() => (window as unknown as { __mediaCalls: unknown[] }).__mediaCalls),
    ).toHaveLength(0);
    await page.getByRole('button', { name: 'Видео' }).click();
  });

  test('starts live, keeps decorative actions inert, cancels stop and then confirms it', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      const calls: MediaStreamConstraints[] = [];
      Object.defineProperty(window, '__mediaCalls', { value: calls, configurable: true });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async (constraints: MediaStreamConstraints) => {
            calls.push(constraints);
            return new MediaStream();
          },
        },
      });
    });
    await openSetup(page);
    await configureCameraBroadcast(page);
    await page.getByRole('button', { name: 'Начать эфир' }).click();
    await expect(page.getByRole('button', { name: 'Остановить эфир' })).toBeVisible();
    const liveGeometry = await page.evaluate(() => {
      const header = document.querySelector('.live-top-controls')?.getBoundingClientRect();
      const comments = document.querySelector('.live-content')?.getBoundingClientRect();
      const bottom = document.querySelector('.live-bottom-controls')?.getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        headerTop: header?.top ?? -1,
        headerBottom: header?.bottom ?? Number.POSITIVE_INFINITY,
        commentsBottom: comments?.bottom ?? Number.POSITIVE_INFINITY,
        bottomTop: bottom?.top ?? Number.NEGATIVE_INFINITY,
        bottomBottom: bottom?.bottom ?? Number.POSITIVE_INFINITY,
        viewportHeight: innerHeight,
      };
    });
    expect(liveGeometry.scrollWidth).toBe(430);
    expect(liveGeometry.headerTop).toBeGreaterThanOrEqual(52);
    expect(liveGeometry.headerBottom).toBeLessThan(130);
    expect(liveGeometry.commentsBottom).toBeLessThanOrEqual(liveGeometry.bottomTop);
    expect(liveGeometry.bottomBottom).toBeLessThan(liveGeometry.viewportHeight - 8);
    await verifyCommentFeedScroll(page);
    await expect(page.locator('.likes-control')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Поставить лайк' })).toBeVisible();
    await expect(page.getByText('Подарка.')).toHaveCount(0);
    const decorative = page.locator('.live-decorative-action');
    await expect(decorative).toHaveCount(2);
    await expect(page.locator('button.live-decorative-action')).toHaveCount(0);
    const beforeDecorativeClick = await page.locator('.live-ui').getAttribute('class');
    await decorative.first().click();
    await decorative.last().click();
    await expect(page.locator('.live-ui')).toHaveAttribute('class', beforeDecorativeClick ?? '');
    await page.getByRole('button', { name: 'Остановить эфир' }).first().click();
    const topConfirmation = page.getByRole('alertdialog', { name: 'Остановить эфир?' });
    await expect(topConfirmation).toBeVisible();
    await topConfirmation.getByRole('button', { name: 'Отмена' }).click();
    await expect(topConfirmation).toBeHidden();
    const settingsTrigger = page.getByRole('button', { name: 'Открыть управление эфиром' });
    await settingsTrigger.click();
    const controlSheet = page.getByRole('dialog', { name: 'Управление эфиром' });
    await expect(controlSheet).toBeVisible();
    await expect(controlSheet).not.toContainText(/Mistral|Deepgram/u);
    expect(
      await page.evaluate(() => (window as unknown as { __mediaCalls: unknown[] }).__mediaCalls),
    ).toHaveLength(1);
    await capture(page, testInfo, 'live-controls.png');
    await page.getByRole('button', { name: 'Закрыть управление эфиром' }).click();
    await expect(controlSheet).toBeHidden();
    await expect(settingsTrigger).toBeFocused();
    await settingsTrigger.click();
    await controlSheet.getByRole('button', { name: 'Остановить эфир' }).click();
    const confirmation = page.getByRole('alertdialog', { name: 'Остановить эфир?' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Отмена' }).click();
    await expect(confirmation).toBeHidden();
    await expect(controlSheet).toBeVisible();
    await controlSheet.getByRole('button', { name: 'Остановить эфир' }).click();
    await confirmation.getByRole('button', { name: 'Остановить эфир' }).click();
    await expect(page.getByRole('button', { name: 'Начать эфир' })).toBeVisible();
  });

  test('requests audio-only media when speech analysis is explicitly enabled', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: MediaStreamConstraints[] = [];
      Object.defineProperty(window, '__mediaCalls', { value: calls, configurable: true });
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async (constraints: MediaStreamConstraints) => {
            calls.push(constraints);
            return new MediaStream();
          },
        },
      });
    });
    await openSetup(page);
    await configureVideoBroadcast(page, { speech: true });
    await page.getByRole('button', { name: 'Начать эфир' }).click();
    await expect(page.getByRole('button', { name: 'Остановить эфир' })).toBeVisible();
    const calls = await page.evaluate(
      () => (window as unknown as { __mediaCalls: MediaStreamConstraints[] }).__mediaCalls,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ video: false });
  });

  test('serves its manifest and registers a production service worker', async ({
    page,
    request,
  }) => {
    await openSetup(page);
    const manifest = await request.get('/manifest.webmanifest');
    expect(manifest.ok()).toBeTruthy();
    const body = (await manifest.json()) as {
      display: string;
      orientation: string;
      icons: unknown[];
    };
    expect(body.display).toBe('standalone');
    expect(body.orientation).toBe('portrait-primary');
    expect(body.icons).toHaveLength(4);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
      )
      .toBeGreaterThan(0);
  });

  test('keeps the app shell available offline', async ({ page, context }) => {
    await openSetup(page);
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
      .toBe('activated');

    // clientsClaim is intentionally disabled: one online reload gives the installed
    // worker control before validating its cache and the offline transition.
    if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    const cachedShell = await page.evaluate(async () => {
      const cacheNames = await caches.keys();
      for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        for (const request of await cache.keys()) {
          const path = new URL(request.url).pathname;
          if (path !== '/' && path !== '/index.html') continue;
          const response = await cache.match(request);
          if (response?.ok && (await response.clone().text()).includes('<div id="root"></div>'))
            return true;
        }
      }
      return false;
    });
    expect(cachedShell).toBe(true);

    await context.setOffline(true);
    try {
      // WebKit fails internal offline navigations before an active worker can
      // answer them. Verify the production worker's cached shell directly and
      // the live document's offline transition instead of masking that engine bug.
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
      await expect(page.getByLabel('Display name')).toBeVisible();
      await expect(page.getByText('Офлайн-режим')).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test('has no console errors or direct third-party traffic', async ({ page }) => {
    const consoleErrors: string[] = [];
    const thirdParty: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (page.url() !== 'about:blank' && url.origin !== new URL(page.url()).origin)
        thirdParty.push(url.href);
    });
    await openSetup(page);
    await page.waitForTimeout(1_500);
    expect(consoleErrors).toEqual([]);
    expect(thirdParty).toEqual([]);
  });
});

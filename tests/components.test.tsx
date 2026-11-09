import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BroadcastSetup } from '@/components/settings/BroadcastSetup';
import { CommentFeed } from '@/components/live/CommentFeed';
import { ReactionLayer } from '@/components/live/ReactionLayer';
import SettingsPanel from '@/components/settings/SettingsPanel';
import { StatusNotices } from '@/components/common/StatusNotices';
import { db } from '@/db/database';
import { sessionManager } from '@/features/session/manager';
import { getPersonaBadge } from '@/features/comments/presentation';
import {
  getPersonaPortraitUrl,
  PERSONA_PORTRAIT_COUNT,
  PERSONA_PORTRAIT_URLS,
} from '@/features/comments/portraits';
import { useSessionStore } from '@/features/session/store';
import { formatCount } from '@/shared/lib/formatCount';
import type { BroadcastSettings, LiveComment, StoredBlob } from '@/shared/types/broadcast';

const avatar: StoredBlob = {
  id: 'avatar_test',
  kind: 'avatar',
  blob: new Blob(['avatar'], { type: 'image/webp' }),
  name: 'avatar.webp',
  type: 'image/webp',
  size: 6,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const completeSettings: BroadcastSettings = {
  key: 'broadcast',
  schemaVersion: 5,
  avatarBlobId: avatar.id,
  displayName: 'Studio Host',
  username: 'studio.host',
  source: { type: 'camera' },
  targetViewers: 500,
  activity: 'normal',
  speechAnalysisEnabled: false,
};

beforeEach(async () => {
  await sessionManager.stop();
  await db.settings.clear();
  await db.blobs.clear();
  await db.blobs.put(avatar);
});

describe('minimal broadcast setup', () => {
  it('renders identity, compact settings and Start in document order', async () => {
    render(<BroadcastSetup initial={undefined} status="idle" onStart={vi.fn()} />);
    expect(await screen.findByLabelText('Display name')).toBeVisible();
    expect(screen.getByLabelText('Username')).toBeVisible();
    const identity = screen.getByRole('region', { name: 'Ведущий' });
    const settings = screen.getByRole('region', { name: 'Настройки эфира' });
    const start = screen.getByRole('button', { name: 'Начать эфир' });
    expect(start).toBeDisabled();
    expect(settings).toContainElement(screen.getByText('Источник'));
    expect(screen.getByText('Зрители')).toBeVisible();
    expect(screen.getByText('Активность')).toBeVisible();
    expect(screen.getByText('Учитывать речь')).toBeVisible();
    expect(identity.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(settings.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(settings.nextElementSibling).toBe(start.closest('.setup-start-zone'));
    expect(document.querySelector('.setup-start-zone')?.previousElementSibling).toBe(settings);
    expect(screen.queryByText('Выбрать')).not.toBeInTheDocument();
    for (const removed of [
      'Подготовка эфира',
      'Экспорт',
      'Импорт',
      'PWA готово',
      'Пропустить',
      'Продолжить',
    ])
      expect(screen.queryByText(removed)).not.toBeInTheDocument();
  });

  it('uses non-contact autofill identifiers for both identity fields', async () => {
    render(<BroadcastSetup initial={undefined} status="idle" onStart={vi.fn()} />);
    const displayName = await screen.findByLabelText('Display name');
    const username = screen.getByLabelText('Username');
    expect(displayName).toHaveAttribute('name', 'broadcast-host-display');
    expect(displayName).toHaveAttribute('autocomplete', 'off');
    expect(displayName).toHaveAttribute('autocapitalize', 'words');
    expect(username).toHaveAttribute('name', 'broadcast-host-handle');
    expect(username).toHaveAttribute('autocomplete', 'off');
    expect(username).toHaveAttribute('autocapitalize', 'none');
    expect(username).toHaveAttribute('spellcheck', 'false');
  });

  it('validates identity inline and strips @ before start', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn(async (_settings: BroadcastSettings) => undefined);
    render(<BroadcastSetup initial={completeSettings} status="idle" onStart={onStart} />);
    const username = await screen.findByLabelText('Username');
    await user.clear(username);
    await user.type(username, '@bad name');
    expect(screen.getByText('Только латиница, цифры, точка и подчёркивание')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Начать эфир' })).toBeDisabled();
    await user.clear(username);
    await user.type(username, '@valid.name');
    await user.click(screen.getByRole('button', { name: 'Начать эфир' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    expect(onStart.mock.calls[0]?.[0].username).toBe('valid.name');
  });

  it('selects video, viewers and activity without a nullable speech choice', async () => {
    const user = userEvent.setup();
    render(<BroadcastSetup initial={undefined} status="idle" onStart={vi.fn()} />);
    await screen.findByLabelText('Display name');
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept="video/*"]');
    expect(input).not.toBeNull();
    await user.upload(
      input as HTMLInputElement,
      new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
    );
    const fileName = await screen.findByText('clip.mp4');
    expect(fileName).toBeVisible();
    const fileRow = fileName.closest('.setup-source-file-row');
    const sourceRow = screen.getByText('Источник').closest('.setup-row');
    const viewersRow = screen.getByText('Зрители').closest('.setup-row');
    if (!fileRow || !sourceRow || !viewersRow) throw new Error('Source layout is incomplete.');
    expect(fileRow.previousElementSibling).toBe(input);
    expect(sourceRow.compareDocumentPosition(fileRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(fileRow.compareDocumentPosition(viewersRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const viewerTarget = screen.getByRole('textbox', { name: 'Целевое количество зрителей' });
    await user.clear(viewerTarget);
    await user.type(viewerTarget, '7421');
    await user.click(screen.getByRole('button', { name: 'Активная' }));
    expect(viewerTarget).toHaveValue('7421');
    expect(screen.getByRole('button', { name: 'Активная' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Камера' }));
    expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument();
  });

  it('defaults speech to off and toggles immediately in both directions', async () => {
    const user = userEvent.setup();
    render(<BroadcastSetup initial={undefined} status="idle" onStart={vi.fn()} />);
    const speech = await screen.findByRole('switch', { name: 'Учитывать речь' });
    expect(speech).toHaveAttribute('aria-checked', 'false');
    expect(speech).toHaveTextContent('Выкл');
    expect(screen.queryByText('Выбрать')).not.toBeInTheDocument();
    await user.click(speech);
    expect(speech).toHaveAttribute('aria-checked', 'true');
    expect(speech).toHaveTextContent('Вкл');
    await user.click(speech);
    expect(speech).toHaveAttribute('aria-checked', 'false');
    expect(speech).toHaveTextContent('Выкл');
  });

  it('restores saved speech and does not gate Start on an extra speech choice', async () => {
    render(
      <BroadcastSetup
        initial={{ ...completeSettings, speechAnalysisEnabled: true }}
        status="idle"
        onStart={vi.fn()}
      />,
    );
    const speech = await screen.findByRole('switch', { name: 'Учитывать речь' });
    expect(speech).toHaveAttribute('aria-checked', 'true');
    expect(speech).toHaveTextContent('Вкл');
    expect(screen.getByRole('button', { name: 'Начать эфир' })).toBeEnabled();
  });

  it('persists edited identity once after the debounced change', async () => {
    const user = userEvent.setup();
    const put = vi.spyOn(db.settings, 'put');
    render(<BroadcastSetup initial={completeSettings} status="idle" onStart={vi.fn()} />);
    const displayName = await screen.findByLabelText('Display name');
    const username = screen.getByLabelText('Username');
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    expect(put).not.toHaveBeenCalled();
    await user.clear(displayName);
    await user.type(displayName, 'New Host');
    await user.clear(username);
    await user.type(username, '@new.host');
    await waitFor(async () => {
      const stored = await db.settings.get('broadcast');
      expect(stored?.displayName).toBe('New Host');
      expect(stored?.username).toBe('new.host');
    });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('does not request camera until Start and never requests microphone when speech is off', async () => {
    const getUserMedia = vi.mocked(navigator.mediaDevices.getUserMedia);
    const stop = vi.fn();
    getUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop }],
      getVideoTracks: () => [],
    } as unknown as MediaStream);
    expect(getUserMedia).not.toHaveBeenCalled();
    await sessionManager.start(completeSettings);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    await sessionManager.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('keeps the session active when microphone permission is denied', async () => {
    const stream = { getTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi
      .mocked(navigator.mediaDevices.getUserMedia)
      .mockResolvedValueOnce(stream)
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await sessionManager.start({ ...completeSettings, speechAnalysisEnabled: true });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(sessionManager.status).toBe('active');
    await sessionManager.stop();
  });

  it('handles camera denial without entering the live state', async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      new DOMException('denied', 'NotAllowedError'),
    );
    await expect(sessionManager.start(completeSettings)).rejects.toThrow(
      'Доступ к камере запрещён',
    );
    expect(sessionManager.status).toBe('error');
  });

  it('shows camera permission and storage quota failures inline', async () => {
    const user = userEvent.setup();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      new DOMException('denied', 'NotAllowedError'),
    );
    const permissionSurface = render(
      <BroadcastSetup
        initial={completeSettings}
        status="idle"
        onStart={(settings) => sessionManager.start(settings)}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Начать эфир' }));
    expect(await screen.findByText(/Доступ к камере запрещён/)).toBeVisible();
    permissionSurface.unmount();

    vi.mocked(navigator.storage.estimate).mockResolvedValueOnce({ usage: 999, quota: 1_000 });
    render(<BroadcastSetup initial={undefined} status="idle" onStart={vi.fn()} />);
    await screen.findByLabelText('Display name');
    const input = document.querySelector<HTMLInputElement>('input[accept="video/*"]');
    expect(input).not.toBeNull();
    await user.upload(
      input as HTMLInputElement,
      new File(['video'], 'too-large-for-quota.mp4', { type: 'video/mp4' }),
    );
    expect(await screen.findByText(/Недостаточно места/)).toBeVisible();
  });
});

describe('live comment presentation', () => {
  it('renders compact comments without obsolete system or gift labels', () => {
    const comments: LiveComment[] = [
      {
        instanceId: 'host-1',
        templateId: 'host',
        author: 'Studio Host',
        avatarSeed: 'studio.host',
        text: 'Сообщение ведущего',
        badge: 'supporter',
        pinned: false,
        isHost: true,
        appearedAt: 0,
      },
    ];
    render(<CommentFeed comments={comments} />);
    expect(screen.getByText('Сообщение ведущего')).toBeVisible();
    expect(document.querySelectorAll('.live-comment')).toHaveLength(1);
    expect(screen.queryByText('Подарка.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Добро пожаловать в комнату трансляции/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Поддерживает эфир')).toBeVisible();
  });

  it('formats counts and creates deterministic local avatar and badge presentation', () => {
    expect(formatCount(286)).toBe('286');
    expect(formatCount(1_000)).toBe('1К');
    expect(formatCount(1_200)).toBe('1,2К');
    expect(formatCount(18_400)).toBe('18,4К');
    expect(formatCount(1_100_000)).toBe('1,1М');
    expect(PERSONA_PORTRAIT_COUNT).toBe(500);
    expect(new Set(PERSONA_PORTRAIT_URLS).size).toBe(500);
    expect(getPersonaPortraitUrl('session:2:mira')).toBe(getPersonaPortraitUrl('session:2:mira'));
    expect(getPersonaPortraitUrl('session:2:mira')).not.toBe(
      getPersonaPortraitUrl('session:3:lena'),
    );
    expect(
      new Set(
        Array.from({ length: PERSONA_PORTRAIT_COUNT }, (_, index) =>
          getPersonaPortraitUrl(`session:${index}:viewer`),
        ),
      ).size,
    ).toBe(PERSONA_PORTRAIT_COUNT);
    expect(PERSONA_PORTRAIT_URLS.every((url) => !/^https?:/u.test(url))).toBe(true);
    const badges = Array.from({ length: 100 }, (_, index) =>
      getPersonaBadge('session', `persona-${index}`),
    );
    expect(badges).toEqual(
      Array.from({ length: 100 }, (_, index) => getPersonaBadge('session', `persona-${index}`)),
    );
    expect(badges.filter(Boolean)).toHaveLength(2);
  });

  it('keeps only the latest 100 comments in a vertically scrollable feed', () => {
    const comments = Array.from({ length: 120 }, (_, index): LiveComment => ({
      instanceId: `comment-${index}`,
      templateId: 'casual',
      author: `Viewer ${index}`,
      avatarSeed: `session:${index}:viewer${index}`,
      text: `message ${index}`,
      badge: null,
      pinned: false,
      isHost: false,
      appearedAt: index,
    }));
    render(<CommentFeed comments={comments} />);
    const feed = screen.getByLabelText('Последние комментарии');
    expect(feed).toHaveClass('comment-feed');
    expect(document.querySelectorAll('.live-comment')).toHaveLength(100);
    expect(screen.queryByText('message 19')).not.toBeInTheDocument();
    expect(screen.getByText('message 119')).toBeVisible();
  });

  it('shows a compact recovery status and closes the control sheet on Escape', async () => {
    const onClose = vi.fn();
    useSessionStore.getState().setCommentPipelineStatus({
      state: 'backoff',
      retryAt: Date.now() + 30_000,
      reason: 'AI_RESPONSE_INVALID',
    });
    render(<SettingsPanel onClose={onClose} onStop={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Управление эфиром' })).toBeVisible();
    expect(screen.getByText('Комментарии временно восстанавливаются')).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not retain ambient or manual reactions while reduced motion is enabled', () => {
    let reduced = true;
    let changeListener: (() => void) | undefined;
    const query = {
      get matches() {
        return reduced;
      },
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        changeListener = listener;
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => query),
    );
    const { rerender } = render(<ReactionLayer intensity={8} manualSignal={1} seed={42} />);
    expect(document.querySelectorAll('.reaction')).toHaveLength(0);

    act(() => {
      reduced = false;
      changeListener?.();
    });
    rerender(<ReactionLayer intensity={8} manualSignal={2} seed={42} />);
    expect(document.querySelectorAll('.reaction').length).toBeGreaterThan(0);

    act(() => {
      reduced = true;
      changeListener?.();
    });
    expect(document.querySelectorAll('.reaction')).toHaveLength(0);
  });

  it('renders an explicit update notification and blocks no inactive update', async () => {
    const apply = vi.fn();
    render(
      <StatusNotices
        needRefresh
        offlineReady={false}
        updateBlocked={false}
        onUpdate={apply}
        onDismissOffline={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(apply).toHaveBeenCalledOnce();
  });
});

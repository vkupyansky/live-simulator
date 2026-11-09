import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from 'react';
import { Avatar } from '@/components/common/Avatar';
import {
  db,
  deleteBlobIfUnused,
  materializeStoredBlob,
  saveBroadcastSettings,
} from '@/db/database';
import { processAvatar } from '@/features/media/avatar';
import { formatBytes, persistVideoFile } from '@/features/media/storage';
import { useVisualViewport } from '@/shared/hooks/useVisualViewport';
import {
  broadcastSettingsSchema,
  displayNameSchema,
  targetViewersSchema,
  usernameSchema,
} from '@/shared/schemas/broadcast';
import {
  BROADCAST_SCHEMA_VERSION,
  BROADCAST_SETTINGS_KEY,
  MAX_TARGET_VIEWERS,
  type ActivityLevel,
  type BroadcastSettings,
  type TargetViewers,
} from '@/shared/types/broadcast';

interface Draft {
  avatarBlobId: string;
  avatarUrl: string;
  displayName: string;
  username: string;
  source: BroadcastSettings['source'] | null;
  videoName: string;
  videoSize: number;
  targetViewers: TargetViewers | null;
  activity: ActivityLevel | null;
  speechAnalysisEnabled: boolean;
}

function settingsSignature(settings: BroadcastSettings): string {
  return JSON.stringify(settings);
}

function scrollIntoViewIfNeeded(element: HTMLInputElement): void {
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
  const margin = 24;
  const rect = element.getBoundingClientRect();
  if (
    (rect.top < viewportTop + margin || rect.bottom > viewportBottom - margin) &&
    typeof element.scrollIntoView === 'function'
  )
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function toSettings(draft: Draft): BroadcastSettings | null {
  const result = broadcastSettingsSchema.safeParse({
    key: BROADCAST_SETTINGS_KEY,
    schemaVersion: BROADCAST_SCHEMA_VERSION,
    avatarBlobId: draft.avatarBlobId,
    displayName: draft.displayName,
    username: draft.username,
    source: draft.source,
    targetViewers: draft.targetViewers,
    activity: draft.activity,
    speechAnalysisEnabled: draft.speechAnalysisEnabled,
  });
  return result.success ? result.data : null;
}

async function loadInitialDraft(settings: BroadcastSettings | undefined): Promise<Draft> {
  const avatarBlob = settings ? await db.blobs.get(settings.avatarBlobId) : undefined;
  const videoBlob =
    settings?.source.type === 'video' ? await db.blobs.get(settings.source.mediaBlobId) : undefined;
  return {
    avatarBlobId: avatarBlob?.id ?? '',
    avatarUrl: avatarBlob ? URL.createObjectURL(materializeStoredBlob(avatarBlob)) : '',
    displayName: settings?.displayName ?? '',
    username: settings?.username ?? '',
    source: settings?.source.type === 'video' && !videoBlob ? null : (settings?.source ?? null),
    videoName: videoBlob?.name ?? '',
    videoSize: videoBlob?.size ?? 0,
    targetViewers: settings?.targetViewers ?? null,
    activity: settings?.activity ?? null,
    speechAnalysisEnabled: settings?.speechAnalysisEnabled ?? false,
  };
}

export function BroadcastSetup({
  initial,
  status,
  onStart,
}: {
  initial: BroadcastSettings | undefined;
  status: 'idle' | 'preparing' | 'error';
  onStart(settings: BroadcastSettings): Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [avatarError, setAvatarError] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [startError, setStartError] = useState('');
  const avatarInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  const focusedField = useRef<HTMLInputElement | null>(null);
  const focusFrame = useRef<number | null>(null);
  const mounted = useRef(true);
  const avatarSelection = useRef(0);
  const videoSelection = useRef(0);
  const lastPersistedSignature = useRef(initial ? settingsSignature(initial) : '');
  const viewport = useVisualViewport();

  useEffect(() => {
    lastPersistedSignature.current = initial ? settingsSignature(initial) : '';
    let cancelled = false;
    let createdUrl = '';
    void loadInitialDraft(initial).then((loaded) => {
      createdUrl = loaded.avatarUrl;
      if (cancelled) {
        if (createdUrl) URL.revokeObjectURL(createdUrl);
        return;
      }
      setDraft(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  useEffect(() => {
    const url = draft?.avatarUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [draft?.avatarUrl]);

  useEffect(() => {
    if (!draft) return;
    const settings = toSettings(draft);
    if (!settings) return;
    const signature = settingsSignature(settings);
    if (signature === lastPersistedSignature.current) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void saveBroadcastSettings(settings).then(() => {
        if (!cancelled) lastPersistedSignature.current = signature;
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draft]);

  useEffect(() => {
    if (!viewport.keyboardOpen) {
      if (main.current) main.current.scrollTop = 0;
      return;
    }
    const field = focusedField.current;
    if (field && document.activeElement === field) scrollIntoViewIfNeeded(field);
  }, [viewport.height, viewport.keyboardOpen]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      avatarSelection.current += 1;
      videoSelection.current += 1;
      if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
    };
  }, []);

  if (!draft)
    return (
      <main className="broadcast-setup loading-screen">
        <span className="setup-loader" />
      </main>
    );

  const displayResult = displayNameSchema.safeParse(draft.displayName);
  const usernameResult = usernameSchema.safeParse(draft.username);
  const targetViewersResult = targetViewersSchema.safeParse(draft.targetViewers);
  const settings = toSettings(draft);

  const selectAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAvatarError('');
    const selection = ++avatarSelection.current;
    const previousId = draft.avatarBlobId;
    try {
      const stored = await processAvatar(file);
      if (!mounted.current || selection !== avatarSelection.current) {
        await deleteBlobIfUnused(stored.id).catch(() => undefined);
        return;
      }
      const avatarUrl = URL.createObjectURL(materializeStoredBlob(stored));
      if (draft.avatarUrl) URL.revokeObjectURL(draft.avatarUrl);
      setDraft((current) =>
        current ? { ...current, avatarBlobId: stored.id, avatarUrl } : current,
      );
      if (previousId) await deleteBlobIfUnused(previousId);
    } catch (error) {
      if (mounted.current && selection === avatarSelection.current)
        setAvatarError(error instanceof Error ? error.message : 'Аватар не сохранён.');
    }
  };

  const selectVideo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMediaError('');
    const selection = ++videoSelection.current;
    const previousId = draft.source?.type === 'video' ? draft.source.mediaBlobId : '';
    try {
      const stored = await persistVideoFile(file);
      if (!mounted.current || selection !== videoSelection.current) {
        await deleteBlobIfUnused(stored.id).catch(() => undefined);
        return;
      }
      setDraft((current) =>
        current
          ? {
              ...current,
              source: { type: 'video', mediaBlobId: stored.id },
              videoName: stored.name,
              videoSize: stored.size,
            }
          : current,
      );
      if (previousId) await deleteBlobIfUnused(previousId);
    } catch (error) {
      if (mounted.current && selection === videoSelection.current)
        setMediaError(error instanceof Error ? error.message : 'Видео не сохранено.');
    }
  };

  const start = async () => {
    if (!settings || status === 'preparing') return;
    setStartError('');
    try {
      await onStart(settings);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : 'Не удалось начать эфир.');
    }
  };

  const focusIdentityField = (event: FocusEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    focusedField.current = field;
    if (focusFrame.current !== null) window.cancelAnimationFrame(focusFrame.current);
    focusFrame.current = window.requestAnimationFrame(() => {
      focusFrame.current = null;
      scrollIntoViewIfNeeded(field);
    });
  };

  const blurIdentityField = (event: FocusEvent<HTMLInputElement>) => {
    if (focusedField.current === event.currentTarget) focusedField.current = null;
  };

  return (
    <main
      ref={main}
      className="broadcast-setup"
      data-keyboard-open={viewport.keyboardOpen ? 'true' : 'false'}
    >
      <section className="setup-identity" aria-label="Ведущий">
        <button
          className="setup-avatar"
          type="button"
          onClick={() => avatarInput.current?.click()}
          aria-label="Выбрать аватар"
        >
          <Avatar dataUrl={draft.avatarUrl} name={draft.displayName} size={82} />
          <span>+</span>
        </button>
        <input
          ref={avatarInput}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => void selectAvatar(event)}
        />
        {avatarError && <small className="setup-error">{avatarError}</small>}
        <label className="setup-field">
          <span className="setup-field-label">Display name</span>
          <input
            aria-label="Display name"
            name="broadcast-host-display"
            value={draft.displayName}
            maxLength={30}
            placeholder="Имя ведущего"
            autoComplete="off"
            autoCapitalize="words"
            onFocus={focusIdentityField}
            onBlur={blurIdentityField}
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
          />
        </label>
        {!displayResult.success && draft.displayName && (
          <small className="setup-error">{displayResult.error.issues[0]?.message}</small>
        )}
        <label className="setup-field setup-username">
          <span className="setup-field-label">Username</span>
          <span className="setup-username-input">
            <span aria-hidden="true">@</span>
            <input
              aria-label="Username"
              name="broadcast-host-handle"
              value={draft.username}
              maxLength={25}
              placeholder="username"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              onFocus={focusIdentityField}
              onBlur={blurIdentityField}
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            />
          </span>
        </label>
        {!usernameResult.success && draft.username && (
          <small className="setup-error">{usernameResult.error.issues[0]?.message}</small>
        )}
      </section>

      <section className="setup-controls" aria-label="Настройки эфира">
        <div className="setup-source-section">
          <div className="setup-row">
            <span>Источник</span>
            <div className="setup-segmented two">
              <button
                type="button"
                aria-pressed={draft.source?.type === 'camera'}
                className={draft.source?.type === 'camera' ? 'active' : ''}
                onClick={() => {
                  setMediaError('');
                  setDraft({ ...draft, source: { type: 'camera' } });
                }}
              >
                Камера
              </button>
              <button
                type="button"
                aria-pressed={draft.source?.type === 'video'}
                className={draft.source?.type === 'video' ? 'active' : ''}
                onClick={() => videoInput.current?.click()}
              >
                Видео
              </button>
            </div>
          </div>
          <input
            ref={videoInput}
            hidden
            type="file"
            accept="video/*"
            onChange={(event) => void selectVideo(event)}
          />
          {draft.source?.type === 'video' && (
            <div className="setup-source-file-row">
              <button
                className="setup-source-file"
                type="button"
                aria-label={`Выбранное видео: ${draft.videoName}, ${formatBytes(draft.videoSize)}`}
                onClick={() => videoInput.current?.click()}
              >
                <span>{draft.videoName}</span>
                <small>{formatBytes(draft.videoSize)}</small>
              </button>
            </div>
          )}
          {mediaError && <small className="setup-error inline">{mediaError}</small>}
        </div>

        <div className="setup-row">
          <span>Зрители</span>
          <label className="viewer-target-control">
            <span className="sr-only">Целевое количество зрителей</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              name="broadcast-audience-target"
              autoComplete="off"
              maxLength={String(MAX_TARGET_VIEWERS).length}
              value={draft.targetViewers ?? ''}
              placeholder="Количество"
              aria-label="Целевое количество зрителей"
              aria-invalid={!targetViewersResult.success}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/gu, '');
                setDraft({
                  ...draft,
                  targetViewers: digits ? Number(digits) : null,
                });
              }}
            />
          </label>
        </div>

        <div className="setup-row activity-row">
          <span>Активность</span>
          <div className="setup-segmented three">
            {(
              [
                ['low', 'Спокойная'],
                ['normal', 'Обычная'],
                ['high', 'Активная'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={draft.activity === value}
                className={draft.activity === value ? 'active' : ''}
                onClick={() => setDraft({ ...draft, activity: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="setup-row">
          <span>Учитывать речь</span>
          <button
            type="button"
            role="switch"
            aria-label="Учитывать речь"
            aria-checked={draft.speechAnalysisEnabled}
            className={`setup-switch${draft.speechAnalysisEnabled ? ' on' : ''}`}
            onClick={() =>
              setDraft({
                ...draft,
                speechAnalysisEnabled: !draft.speechAnalysisEnabled,
              })
            }
          >
            <i aria-hidden="true" />
            <b>{draft.speechAnalysisEnabled ? 'Вкл' : 'Выкл'}</b>
          </button>
        </div>
      </section>

      <section className="setup-start-zone">
        <button
          className="setup-start"
          type="button"
          disabled={!settings || status === 'preparing'}
          onClick={() => void start()}
        >
          Начать эфир
        </button>
        {startError && <small className="setup-error">{startError}</small>}
      </section>
    </main>
  );
}

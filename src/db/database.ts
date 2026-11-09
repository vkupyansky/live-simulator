import Dexie, { type EntityTable } from 'dexie';
import { validateBroadcastSettings } from '@/shared/schemas/broadcast';
import {
  BROADCAST_SETTINGS_KEY,
  type BroadcastSettings,
  type StoredBlob,
} from '@/shared/types/broadcast';

export class SimulatorDatabase extends Dexie {
  settings!: EntityTable<BroadcastSettings, 'key'>;
  blobs!: EntityTable<StoredBlob, 'id'>;

  constructor(name = 'live-simulator') {
    super(name);
    this.version(5).stores({
      settings: 'key',
      blobs: 'id, kind, createdAt',
    });
  }
}

export const db = new SimulatorDatabase();

function isBlobStorageCompatibilityError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false;
  return error.name === 'UnknownError' || error.name === 'DataCloneError';
}

export function materializeStoredBlob(stored: StoredBlob): Blob {
  return stored.blob instanceof Blob ? stored.blob : new Blob([stored.blob], { type: stored.type });
}

export async function getBroadcastSettings(): Promise<BroadcastSettings | undefined> {
  const value = await db.settings.get(BROADCAST_SETTINGS_KEY);
  return value ? validateBroadcastSettings(value) : undefined;
}

export async function saveBroadcastSettings(
  settings: BroadcastSettings,
  database: SimulatorDatabase = db,
): Promise<void> {
  const valid = validateBroadcastSettings(settings);
  await database.transaction('rw', database.settings, database.blobs, async () => {
    await database.settings.put(valid);
    const retained = new Set([
      valid.avatarBlobId,
      ...(valid.source.type === 'video' ? [valid.source.mediaBlobId] : []),
    ]);
    const blobs = await database.blobs.toArray();
    await database.blobs.bulkDelete(
      blobs.filter((blob) => !retained.has(blob.id)).map((blob) => blob.id),
    );
  });
}

export async function saveBlob(blob: StoredBlob, database: SimulatorDatabase = db): Promise<void> {
  try {
    await database.blobs.put(blob);
  } catch (error) {
    if (!(blob.blob instanceof Blob) || !isBlobStorageCompatibilityError(error)) throw error;
    await database.blobs.put({ ...blob, blob: await blob.blob.arrayBuffer() });
  }
}

export async function deleteBlobIfUnused(id: string): Promise<void> {
  const settings = await getBroadcastSettings();
  if (
    settings?.avatarBlobId === id ||
    (settings?.source.type === 'video' && settings.source.mediaBlobId === id)
  )
    return;
  await db.blobs.delete(id);
}

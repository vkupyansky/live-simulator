import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  materializeStoredBlob,
  saveBlob,
  SimulatorDatabase,
  saveBroadcastSettings,
} from '@/db/database';
import { validateBroadcastSettings } from '@/shared/schemas/broadcast';

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)));
});

describe('singleton Dexie storage', () => {
  it('creates the current schema directly with only settings and blobs stores', async () => {
    const name = `schema-${crypto.getRandomValues(new Uint32Array(1))[0]}`;
    names.push(name);
    const database = new SimulatorDatabase(name);
    await database.open();
    expect(database.verno).toBe(5);
    expect(database.tables.map((table) => table.name).sort()).toEqual(['blobs', 'settings']);
    database.close();
  });

  it('validates singleton settings and removes unreferenced blobs on save', async () => {
    const name = `singleton-${crypto.getRandomValues(new Uint32Array(1))[0]}`;
    names.push(name);
    const database = new SimulatorDatabase(name);
    await database.open();
    await database.blobs.bulkPut([
      {
        id: 'avatar',
        kind: 'avatar',
        blob: new Blob(),
        name: 'a',
        type: 'image/webp',
        size: 0,
        createdAt: 'now',
      },
      {
        id: 'orphan',
        kind: 'video',
        blob: new Blob(),
        name: 'o',
        type: 'video/mp4',
        size: 0,
        createdAt: 'now',
      },
    ]);
    const settings = validateBroadcastSettings({
      key: 'broadcast',
      schemaVersion: 5,
      avatarBlobId: 'avatar',
      displayName: ' Host ',
      username: '@host.name',
      source: { type: 'camera' },
      targetViewers: 100,
      activity: 'low',
      speechAnalysisEnabled: false,
    });
    expect(settings.displayName).toBe('Host');
    expect(settings.username).toBe('host.name');
    await saveBroadcastSettings(settings, database);
    expect(await database.settings.get('broadcast')).toEqual(settings);
    expect(await database.blobs.get('avatar')).toBeDefined();
    expect(await database.blobs.get('orphan')).toBeUndefined();
    database.close();
  });

  it('falls back to ArrayBuffer when WebKit cannot persist Blob values', async () => {
    const name = `webkit-blob-${crypto.getRandomValues(new Uint32Array(1))[0]}`;
    names.push(name);
    const database = new SimulatorDatabase(name);
    await database.open();
    const put = vi
      .spyOn(database.blobs, 'put')
      .mockRejectedValueOnce(new DOMException('Blob storage failed', 'UnknownError'));
    await saveBlob(
      {
        id: 'webkit-avatar',
        kind: 'avatar',
        blob: new Blob(['avatar'], { type: 'image/webp' }),
        name: 'avatar.webp',
        type: 'image/webp',
        size: 6,
        createdAt: 'now',
      },
      database,
    );
    expect(put).toHaveBeenCalledTimes(2);
    const stored = await database.blobs.get('webkit-avatar');
    expect(stored?.blob).not.toBeInstanceOf(Blob);
    expect(stored && (await materializeStoredBlob(stored).text())).toBe('avatar');
    database.close();
  });
});

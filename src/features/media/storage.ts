import { saveBlob } from '@/db/database';
import { createId } from '@/shared/lib/ids';
import { MAX_VIDEO_BYTES, type StoredBlob } from '@/shared/types/broadcast';

interface StorageInfo {
  usage: number;
  quota: number;
  available: number;
}

async function getStorageInfo(): Promise<StorageInfo> {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0, available: 0 };
  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage ?? 0;
  const quota = estimate.quota ?? 0;
  return { usage, quota, available: Math.max(0, quota - usage) };
}

export async function persistVideoFile(file: File): Promise<StoredBlob> {
  if (!file.type.startsWith('video/')) throw new Error('Выберите видео поддерживаемого формата.');
  if (file.size > MAX_VIDEO_BYTES) throw new Error('Видео должно быть меньше 350 МБ.');
  const storage = await getStorageInfo();
  if (storage.quota > 0 && file.size > storage.available * 0.9)
    throw new Error('Недостаточно места. Выберите файл меньшего размера.');
  const media: StoredBlob = {
    id: createId('video'),
    kind: 'video',
    blob: file,
    name: file.name,
    type: file.type,
    size: file.size,
    createdAt: new Date().toISOString(),
  };
  try {
    await saveBlob(media);
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.name === 'UnknownError')
    )
      throw new Error('Хранилище заполнено. Видео не сохранено.', { cause: error });
    throw error;
  }
  return media;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

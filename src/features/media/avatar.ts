import { saveBlob } from '@/db/database';
import { createId } from '@/shared/lib/ids';
import { MAX_AVATAR_INPUT_BYTES, type StoredBlob } from '@/shared/types/broadcast';

const AVATAR_SIZE = 512;
const ACCEPTED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function decodeImage(file: File): Promise<ImageBitmap> {
  if (!('createImageBitmap' in window)) throw new Error('Обработка изображения не поддерживается.');
  return await createImageBitmap(file, { imageOrientation: 'from-image' });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось обработать аватар.'))),
      'image/webp',
      0.86,
    );
  });
}

export async function processAvatar(file: File): Promise<StoredBlob> {
  if (!ACCEPTED_AVATAR_TYPES.has(file.type)) throw new Error('Используйте JPEG, PNG или WebP.');
  if (file.size > MAX_AVATAR_INPUT_BYTES) throw new Error('Аватар должен быть меньше 8 МБ.');
  const image = await decodeImage(file);
  try {
    const side = Math.min(image.width, image.height);
    const sourceX = (image.width - side) / 2;
    const sourceY = (image.height - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Не удалось подготовить изображение.');
    context.drawImage(image, sourceX, sourceY, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const blob = await canvasToBlob(canvas);
    context.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    canvas.width = 1;
    canvas.height = 1;
    const stored: StoredBlob = {
      id: createId('avatar'),
      kind: 'avatar',
      blob,
      name: 'avatar.webp',
      type: blob.type,
      size: blob.size,
      createdAt: new Date().toISOString(),
    };
    await saveBlob(stored);
    return stored;
  } finally {
    image.close();
  }
}

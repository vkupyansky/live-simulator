export const FRAME_MAX_WIDTH = 576;
export const FRAME_MAX_HEIGHT = 1024;
export const FRAME_MAX_BYTES = 400 * 1024;
export const FRAME_JPEG_QUALITY = 0.82;
export const FORCE_FRAME_INTERVAL_MS = 50_000;
export const SCENE_CHANGE_THRESHOLD = 0.115;
const SIGNATURE_WIDTH = 18;
const SIGNATURE_HEIGHT = 32;

export interface FrameDimensions {
  width: number;
  height: number;
}

export interface CapturedFrame {
  dataUrl: string;
  size: number;
  width: number;
  height: number;
  signature: Uint8Array;
  sceneChanged: boolean;
  quality: FrameQualityMetrics;
}

export interface FrameQualityMetrics {
  meanLuminance: number;
  luminanceDeviation: number;
  darkPixelRatio: number;
  clippedBlackRatio: number;
}

export function calculateFrameDimensions(width: number, height: number): FrameDimensions {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, FRAME_MAX_WIDTH / width, FRAME_MAX_HEIGHT / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function normalizedSceneDifference(left: Uint8Array, right: Uint8Array): number {
  if (left.length === 0 || left.length !== right.length) return 1;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
  return difference / (left.length * 255);
}

export function normalizedSceneRmsDifference(left: Uint8Array, right: Uint8Array): number {
  if (left.length === 0 || left.length !== right.length) return 1;
  let squaredDifference = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    squaredDifference += difference * difference;
  }
  return Math.sqrt(squaredDifference / left.length) / 255;
}

export function measureFrameQuality(signature: Uint8Array): FrameQualityMetrics {
  if (signature.length === 0)
    return {
      meanLuminance: 0,
      luminanceDeviation: 0,
      darkPixelRatio: 1,
      clippedBlackRatio: 1,
    };

  let sum = 0;
  let squaredSum = 0;
  let darkPixels = 0;
  let clippedBlackPixels = 0;
  for (const luminance of signature) {
    sum += luminance;
    squaredSum += luminance * luminance;
    if (luminance <= 40) darkPixels += 1;
    if (luminance <= 8) clippedBlackPixels += 1;
  }
  const mean = sum / signature.length;
  const variance = Math.max(0, squaredSum / signature.length - mean * mean);
  return {
    meanLuminance: mean / 255,
    luminanceDeviation: Math.sqrt(variance) / 255,
    darkPixelRatio: darkPixels / signature.length,
    clippedBlackRatio: clippedBlackPixels / signature.length,
  };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось подготовить кадр.'))),
      'image/jpeg',
      quality,
    );
  });
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать кадр.'));
    reader.readAsDataURL(blob);
  });
}

function signatureFor(video: HTMLVideoElement): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = SIGNATURE_WIDTH;
  canvas.height = SIGNATURE_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    canvas.width = 1;
    canvas.height = 1;
    return new Uint8Array();
  }
  try {
    context.drawImage(video, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
    const pixels = context.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT).data;
    const signature = new Uint8Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
    for (let pixel = 0; pixel < signature.length; pixel += 1) {
      const offset = pixel * 4;
      signature[pixel] = Math.round(
        (pixels[offset] ?? 0) * 0.299 +
          (pixels[offset + 1] ?? 0) * 0.587 +
          (pixels[offset + 2] ?? 0) * 0.114,
      );
    }
    return signature;
  } finally {
    context.clearRect(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function captureVideoFrame(
  video: HTMLVideoElement,
  previousSignature: Uint8Array | null,
  force: boolean,
): Promise<CapturedFrame | null> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  const dimensions = calculateFrameDimensions(video.videoWidth, video.videoHeight);
  if (dimensions.width === 0 || dimensions.height === 0) return null;
  const signature = signatureFor(video);
  const sceneChanged =
    !previousSignature ||
    normalizedSceneRmsDifference(previousSignature, signature) >= SCENE_CHANGE_THRESHOLD;
  const frameQuality = measureFrameQuality(signature);
  if (!force && !sceneChanged)
    return {
      dataUrl: '',
      size: 0,
      width: dimensions.width,
      height: dimensions.height,
      signature,
      sceneChanged: false,
      quality: frameQuality,
    };

  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    canvas.width = 1;
    canvas.height = 1;
    throw new Error('Canvas недоступен для анализа кадра.');
  }
  try {
    context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
    let quality = FRAME_JPEG_QUALITY;
    let blob = await toBlob(canvas, quality);
    while (blob.size > FRAME_MAX_BYTES && quality > 0.35) {
      quality -= 0.08;
      blob = await toBlob(canvas, quality);
    }
    if (blob.size > FRAME_MAX_BYTES) throw new Error('Кадр превышает допустимый размер.');
    return {
      dataUrl: await toDataUrl(blob),
      size: blob.size,
      width: dimensions.width,
      height: dimensions.height,
      signature,
      sceneChanged,
      quality: frameQuality,
    };
  } finally {
    context.clearRect(0, 0, dimensions.width, dimensions.height);
    canvas.width = 1;
    canvas.height = 1;
  }
}

export function runWhenIdle<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let cancelScheduled: () => void = () => undefined;
    const abort = () => {
      cancelScheduled();
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Операция отменена', 'AbortError'));
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    const execute = () => {
      cancelScheduled = () => undefined;
      signal.removeEventListener('abort', abort);
      if (signal.aborted) abort();
      else void operation().then(resolve, reject);
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(execute, { timeout: 800 });
      cancelScheduled = () => idleWindow.cancelIdleCallback?.(handle);
    } else {
      const handle = globalThis.setTimeout(execute, 0);
      cancelScheduled = () => globalThis.clearTimeout(handle);
    }
  });
}

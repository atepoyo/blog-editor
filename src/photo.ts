import type { Photo } from './article';
import { EditorError } from './messages';

export function resizedDimensions(width: number, height: number) {
  if (width <= 0 || height <= 0 || !Number.isFinite(width + height)) {
    throw new EditorError('invalidDimensions');
  }
  const ratio = Math.min(1, 1920 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

export async function resizePhoto(source: File): Promise<Photo> {
  const objectUrl = URL.createObjectURL(source);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new EditorError('unreadablePhoto'));
      image.src = objectUrl;
    });
    const { width, height } = resizedDimensions(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    try {
      const context = canvas.getContext('2d');
      if (!context) throw new EditorError('canvasUnavailable');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result?.type === 'image/jpeg') resolve(result);
          else reject(new EditorError('jpegFailed'));
        }, 'image/jpeg', 1.0);
      });
      const name = `${crypto.randomUUID()}.jpg`;
      return { file: new File([blob], name, { type: 'image/jpeg' }), path: `images/${name}` };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    image.src = '';
    URL.revokeObjectURL(objectUrl);
  }
}

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

// Extraction goes through Gemini's free tier, which is rate- and
// token-limited. Libreta photos don't need full resolution for handwriting
// OCR, so they get compressed harder than logos/attachments to keep each
// request small and fast.
export const OCR_MAX_DIMENSION = 1280;
const OCR_JPEG_QUALITY = 0.75;

function loadResizedCanvas(file: File, maxDimension: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No pudimos leer la imagen."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No pudimos procesar la imagen."));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("No pudimos procesar la imagen."));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export async function fileToResizedDataUrl(
  file: File,
  options?: { maxDimension?: number; quality?: number },
): Promise<string> {
  const canvas = await loadResizedCanvas(file, options?.maxDimension ?? MAX_DIMENSION);
  return canvas.toDataURL("image/jpeg", options?.quality ?? JPEG_QUALITY);
}

// Dedicated entry point for the libreta-import flow — smaller and more
// compressed than the default, specifically to reduce Gemini token usage.
export async function fileToResizedDataUrlForOcr(file: File): Promise<string> {
  return fileToResizedDataUrl(file, { maxDimension: OCR_MAX_DIMENSION, quality: OCR_JPEG_QUALITY });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No pudimos comprimir la imagen."))),
      "image/jpeg",
      quality,
    );
  });
}

export async function fileToResizedBlob(file: File): Promise<Blob> {
  const canvas = await loadResizedCanvas(file, MAX_DIMENSION);
  return canvasToJpeg(canvas, JPEG_QUALITY);
}

// A PHOTO AND ITS THUMBNAIL FROM ONE DECODE. The photo is exactly what
// `fileToResizedBlob` returns; the thumbnail is drawn from that same canvas, `width`
// pixels wide with the proportion kept, and never enlarged.
//
// JPEG AND NOT WEBP, although WebP is smaller: Safari on iPhone cannot encode WebP from a
// canvas and hands back a PNG instead, without an error -- several times the size, and
// under a name and a content type that say something else.
//
// THE THUMBNAIL MAY COME BACK `null` and that is not a failure of the upload: a phone
// short on memory can refuse the second canvas. The caller uploads the photo anyway; the
// screens fall back to the photo, and the nightly pass makes the thumbnail later.
export async function fileToPhotoAndThumbnail(
  file: File,
  thumbnail: { width: number; quality: number },
): Promise<{ photo: Blob; thumbnail: Blob | null }> {
  const canvas = await loadResizedCanvas(file, MAX_DIMENSION);
  const photo = await canvasToJpeg(canvas, JPEG_QUALITY);
  try {
    const scale = Math.min(1, thumbnail.width / canvas.width);
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(canvas.width * scale));
    small.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = small.getContext("2d");
    if (!ctx) return { photo, thumbnail: null };
    ctx.drawImage(canvas, 0, 0, small.width, small.height);
    return { photo, thumbnail: await canvasToJpeg(small, thumbnail.quality / 100) };
  } catch (error) {
    console.error("[image] thumbnail:", error);
    return { photo, thumbnail: null };
  }
}

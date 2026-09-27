"use client";

// Client-side photo pipeline (boot S4-02 task 3). The bucket accepts 5 MB, but the storefront has to
// load these over mobile data, so nothing leaves the browser above ~1 MB / 1600 px: the 5 MB limit is
// the backstop, not the target. Decoding happens off the main thread where `createImageBitmap` exists.

export const MAX_EDGE = 1600;
export const TARGET_BYTES = 1_000_000;

export type Prepared = {
  blob: Blob;
  /** Output mime — png stays png (flat art, transparency), everything else becomes webp/jpeg. */
  type: string;
  width: number;
  height: number;
  /** Data URL for the local preview, so the list renders before the upload finishes. */
  preview: string;
};

/** Focal point in 0..1 of the source image; the crop window is centred on it as far as it fits. */
export type Focal = { x: number; y: number };

export const CENTRE: Focal = { x: 0.5, y: 0.5 };

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode_failed"));
      img.src = url;
    });
  } finally {
    // the bitmap is already painted by the time the caller draws it; revoking here is safe for <img>
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode_failed"))), type, quality);
  });
}

function supportsWebp(): boolean {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  return c.toDataURL("image/webp").startsWith("data:image/webp");
}

/**
 * The crop window inside the source, for a target aspect, centred on `focal` and clamped to the
 * image. Returns source-pixel coordinates. `aspect = null` keeps the whole frame.
 */
export function cropWindow(
  sw: number,
  sh: number,
  aspect: number | null,
  focal: Focal,
): { sx: number; sy: number; sWidth: number; sHeight: number } {
  if (!aspect) return { sx: 0, sy: 0, sWidth: sw, sHeight: sh };
  let cw = sw;
  let ch = sw / aspect;
  if (ch > sh) {
    ch = sh;
    cw = sh * aspect;
  }
  const sx = Math.min(Math.max(focal.x * sw - cw / 2, 0), sw - cw);
  const sy = Math.min(Math.max(focal.y * sh - ch / 2, 0), sh - ch);
  return { sx: Math.round(sx), sy: Math.round(sy), sWidth: Math.round(cw), sHeight: Math.round(ch) };
}

/**
 * Decode → optional focal crop → downscale to `MAX_EDGE` → re-encode, dropping quality in steps
 * until the blob fits `TARGET_BYTES`. PNG is kept as PNG (it is usually flat art); JPEG/WEBP/AVIF all
 * come out as WEBP where the browser can write it, JPEG otherwise.
 */
export async function preparePhoto(file: File, opts: { aspect?: number | null; focal?: Focal } = {}): Promise<Prepared> {
  const source = await decode(file);
  const sw = source.width;
  const sh = source.height;
  const win = cropWindow(sw, sh, opts.aspect ?? null, opts.focal ?? CENTRE);

  const scale = Math.min(1, MAX_EDGE / Math.max(win.sWidth, win.sHeight));
  const width = Math.max(1, Math.round(win.sWidth * scale));
  const height = Math.max(1, Math.round(win.sHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source as CanvasImageSource, win.sx, win.sy, win.sWidth, win.sHeight, 0, 0, width, height);
  if ("close" in source && typeof source.close === "function") source.close();

  const type = file.type === "image/png" ? "image/png" : supportsWebp() ? "image/webp" : "image/jpeg";
  let blob = await encode(canvas, type, 0.82);
  if (type !== "image/png") {
    for (const q of [0.7, 0.6, 0.5]) {
      if (blob.size <= TARGET_BYTES) break;
      blob = await encode(canvas, type, q);
    }
  }
  return { blob, type: blob.type || type, width, height, preview: canvas.toDataURL(type === "image/png" ? "image/png" : "image/jpeg", 0.7) };
}

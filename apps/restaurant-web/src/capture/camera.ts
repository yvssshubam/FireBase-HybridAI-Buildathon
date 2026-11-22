// Webcam capture (getUserMedia) and JPEG encoding under a size cap.
import { sha256Hex, toBase64 } from "./hash.ts";

export interface CapturedJpeg {
  blob: Blob;
  bytes: Uint8Array<ArrayBuffer>;
  base64: string;
  sha256: string;
  width: number;
  height: number;
  /** Wall-clock time of the shutter press (ms). */
  capturedAt: number;
}

export class CameraError extends Error {}

export async function openCamera(): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError("The camera needs a secure page (https:// or localhost) in a current Chrome.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: "environment" },
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new CameraError("Camera permission was denied. Allow the camera for this site (address bar → site settings) and try again.");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new CameraError("No camera was found on this computer.");
    if (name === "NotReadableError" || name === "AbortError") {
      throw new CameraError("The camera is busy in another app or tab. Close it there and try again.");
    }
    throw new CameraError(`Could not open the camera (${name || String(e)}).`);
  }
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Draws the current video frame, scaled so the longer side is at most `maxSide`. */
export function grabFrame(video: HTMLVideoElement, maxSide: number): HTMLCanvasElement {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w === 0 || h === 0) throw new CameraError("The camera isn't showing a picture yet. Wait a moment and try again.");
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return drawScaled(video, w, h, scale);
}

/** A chosen photo file → a canvas scaled like a camera frame (EXIF rotation applied). */
export async function frameFromFile(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  if (!file.type.startsWith("image/")) throw new CameraError("Choose a photo file (JPEG, PNG or WebP).");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new CameraError("That file couldn't be opened as a photo. Try a JPEG or PNG.");
  }
  try {
    return drawScaled(bitmap, bitmap.width, bitmap.height, Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height)));
  } finally {
    bitmap.close();
  }
}

export function shrinkTo(canvas: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  return drawScaled(canvas, canvas.width, canvas.height, Math.min(1, maxSide / Math.max(canvas.width, canvas.height)));
}

function drawScaled(src: CanvasImageSource, w: number, h: number, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new CameraError("This browser can't draw images (canvas 2D unavailable).");
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new CameraError("JPEG encoding failed."))), "image/jpeg", quality);
  });
}

/**
 * Encodes as JPEG strictly under `maxBytes`, lowering quality first and then size.
 * Storage rules reject anything at or over the cap, so this must hold exactly.
 */
export async function encodeUnder(canvas: HTMLCanvasElement, maxBytes: number, capturedAt: number): Promise<CapturedJpeg> {
  let current = canvas;
  for (let shrink = 0; shrink < 6; shrink++) {
    for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
      const blob = await toJpeg(current, q);
      if (blob.size < maxBytes) return finish(blob, current, capturedAt);
    }
    current = drawScaled(current, current.width, current.height, 0.75);
  }
  throw new CameraError("Could not make the photo small enough to upload.");
}

async function finish(blob: Blob, canvas: HTMLCanvasElement, capturedAt: number): Promise<CapturedJpeg> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { blob, bytes, base64: toBase64(bytes), sha256: await sha256Hex(bytes), width: canvas.width, height: canvas.height, capturedAt };
}

// Size caps from storage.rules (strictly less than).
export const PHOTO_MAX_BYTES = 290 * 1024; // counter/{id}/photo.jpg < 300 KB; also the image the model sees
export const THUMB_MAX_BYTES = 58 * 1024; // dispatch/{orderId}/thumb.jpg < 60 KB
export const PHOTO_MAX_SIDE = 1024;
export const THUMB_MAX_SIDE = 360;

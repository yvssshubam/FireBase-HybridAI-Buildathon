// Evidence images from Storage (crop, dispatch thumbnail, counter photo).
// getBytes() needs CORS on the bucket (storage.cors.json); the bytes are hashed for the
// audit and shown through a blob: URL (CSP img-src allows blob:).
// TODO(verify): CORS need for getBytes on the real bucket (firebase.google.com/docs/storage/web/download-files).
import { getBytes, ref, type FirebaseStorage } from "firebase/storage";
import { sha256Hex } from "../capture/hash.ts";

export interface StoredImage {
  url: string;
  sha256: string;
  bytes: number;
}

const MAX_DOWNLOAD = 400 * 1024; // every stored image is < 300 KB by rule
const cache = new Map<string, Promise<StoredImage>>();

export function loadImage(storage: FirebaseStorage, path: string): Promise<StoredImage> {
  let p = cache.get(path);
  if (!p) {
    p = getBytes(ref(storage, path), MAX_DOWNLOAD).then(async (buf) => ({
      url: URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })),
      sha256: await sha256Hex(buf),
      bytes: buf.byteLength,
    }));
    // Don't cache failures: a later attempt (e.g. after fixing CORS) should retry.
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

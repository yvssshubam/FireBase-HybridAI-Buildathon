// Orders (realtime) and Flow A dispatch writes.
import type { DispatchCheck, InferenceSource } from "@fairclaim/schemas";
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch, type Firestore } from "firebase/firestore";
import { getMetadata, ref, uploadBytes, type FirebaseStorage } from "firebase/storage";
import { parseOrder, type OrderDoc } from "./docs.ts";

export interface OrdersSnapshot {
  orders: OrderDoc[];
  /** Documents that failed validation (shown, never silently dropped). */
  unreadable: string[];
}

const STATUS_RANK = { placed: 0, dispatched: 1, delivered: 2 } as const;

export function sortOrders(orders: OrderDoc[]): OrderDoc[] {
  return [...orders].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (b.createdAt ?? Number.MAX_SAFE_INTEGER) - (a.createdAt ?? Number.MAX_SAFE_INTEGER));
}

export function watchOrders(db: Firestore, restaurantId: string, next: (s: OrdersSnapshot) => void, fail: (e: unknown) => void): () => void {
  const q = query(collection(db, "orders"), where("restaurantId", "==", restaurantId));
  return onSnapshot(
    q,
    (snap) => {
      const orders: OrderDoc[] = [];
      const unreadable: string[] = [];
      for (const d of snap.docs) {
        try {
          orders.push(parseOrder(d.id, d.data({ serverTimestamps: "estimate" })));
        } catch (e) {
          unreadable.push(e instanceof Error ? e.message : d.id);
        }
      }
      next({ orders: sortOrders(orders), unreadable });
    },
    fail,
  );
}

export interface DispatchEvidence {
  check: DispatchCheck;
  inferenceSource: InferenceSource;
  imageSha256: string;
  capturedAt: number;
  thumb: { blob: Blob; sha256: string } | null;
}

export const thumbPath = (orderId: string) => `dispatch/${orderId}/thumb.jpg`;

/**
 * Uploads a create-once JPEG. If an earlier attempt already stored the same bytes
 * (the Firestore batch failed after the upload), reuse it instead of failing.
 */
export async function uploadOnce(storage: FirebaseStorage, path: string, blob: Blob, sha256: string): Promise<"uploaded" | "reused"> {
  const r = ref(storage, path);
  try {
    await uploadBytes(r, blob, { contentType: "image/jpeg", customMetadata: { sha256 } });
    return "uploaded";
  } catch (e) {
    const meta = await getMetadata(r).catch(() => null);
    if (meta?.customMetadata?.sha256 === sha256) return "reused";
    if (meta) throw new Error(`A different photo is already stored for this record (${path}); stored photos can't be replaced.`, { cause: e });
    throw e;
  }
}

export interface DispatchResult {
  thumbStored: boolean;
  thumbError: string | null;
}

/** One batch: order → dispatched + sealCode, and dispatch/{orderId} (rules check both together). */
export async function recordDispatch(
  db: Firestore,
  storage: FirebaseStorage,
  order: OrderDoc,
  sealCode: string,
  ev: DispatchEvidence,
): Promise<DispatchResult> {
  // The thumbnail is optional: if Storage refuses it, the evidence still counts.
  let thumbRef: string | null = null;
  let thumbError: string | null = null;
  if (ev.thumb) {
    try {
      await uploadOnce(storage, thumbPath(order.id), ev.thumb.blob, ev.thumb.sha256);
      thumbRef = thumbPath(order.id);
    } catch (e) {
      thumbError = e instanceof Error ? e.message : String(e);
    }
  }
  const b = writeBatch(db);
  b.update(doc(db, "orders", order.id), { status: "dispatched", sealCode, dispatchedAt: serverTimestamp() });
  b.set(doc(db, "dispatch", order.id), {
    check: ev.check,
    inferenceSource: ev.inferenceSource,
    imageSha256: ev.imageSha256,
    thumbRef,
    capturedAt: ev.capturedAt,
    recordedAt: serverTimestamp(),
  });
  await b.commit();
  return { thumbStored: thumbRef !== null, thumbError };
}

/** "Dispatch without photo": no evidence doc, so later claims on this order go to a hold. */
export async function dispatchWithoutPhoto(db: Firestore, order: OrderDoc, sealCode: string): Promise<void> {
  await updateDoc(doc(db, "orders", order.id), { status: "dispatched", sealCode, dispatchedAt: serverTimestamp() });
}

// The seal code must survive a reload or a closed tab: staff may already have written it on the sticker.
const sealKey = (orderId: string) => `fairclaim.seal.${orderId}`;

export function rememberedSealCode(orderId: string): string | null {
  try {
    const v = localStorage.getItem(sealKey(orderId));
    return v && /^[0-9]{4}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberSealCode(orderId: string, code: string): void {
  try {
    localStorage.setItem(sealKey(orderId), code);
  } catch {
    // Storage blocked: the code lives for this page only.
  }
}

// Hold transitions the restaurant can make (firestore.rules /holds).
import { doc, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore";
import type { HoldDoc } from "./docs.ts";
import { shouldSettle } from "./hold.ts";

export async function acceptHold(db: Firestore, claimId: string): Promise<void> {
  await updateDoc(doc(db, "holds", claimId), { state: "accepted", resolvedAt: serverTimestamp() });
}

/**
 * Settles every expired, unanswered hold. Rules decide "expired" by server time, so a
 * hold that only looks expired on a fast local clock is rejected now and settled later.
 */
export async function settleExpiredHolds(db: Firestore, holds: Iterable<HoldDoc>, now: number): Promise<number> {
  let settled = 0;
  for (const h of holds) {
    if (!shouldSettle(h, now)) continue;
    try {
      await updateDoc(doc(db, "holds", h.claimId), { state: "settled", resolvedAt: serverTimestamp() });
      settled++;
    } catch {
      // Not yet past the window by server time, or already answered elsewhere.
    }
  }
  return settled;
}

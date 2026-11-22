// Loads the stored evidence behind one decision: order, claim, dispatch, handoff.
import { doc, getDoc, type Firestore } from "firebase/firestore";
import { parseClaim, parseDispatch, parseHandoff, parseOrder, type DecisionDoc } from "./docs.ts";
import type { CaseDocs } from "./engineInput.ts";

export type CaseLoad =
  | { ok: true; docs: CaseDocs }
  | { ok: false; kind: "claim_deleted" }
  | { ok: false; kind: "unreadable"; detail: string };

const code = (e: unknown) => (typeof e === "object" && e !== null && "code" in e ? String(e.code) : "");

export async function loadCase(db: Firestore, decision: Pick<DecisionDoc, "claimId" | "orderId">): Promise<CaseLoad> {
  const [orderSnap, dispatchSnap, handoffSnap] = await Promise.all([
    getDoc(doc(db, "orders", decision.orderId)),
    getDoc(doc(db, "dispatch", decision.orderId)),
    getDoc(doc(db, "handoff", decision.orderId)),
  ]);
  let claimSnap;
  try {
    claimSnap = await getDoc(doc(db, "claims", decision.claimId));
  } catch (e) {
    // The claims read rule looks at resource.data, so a deleted claim reads as
    // permission-denied rather than "not found". Our own order was readable above.
    if (code(e) === "permission-denied") return { ok: false, kind: "claim_deleted" };
    throw e;
  }
  // The customer may use "Delete my data" (§23); that is not tampering.
  if (!claimSnap.exists()) return { ok: false, kind: "claim_deleted" };
  if (!orderSnap.exists()) return { ok: false, kind: "unreadable", detail: `orders/${decision.orderId} missing` };
  try {
    const docs: CaseDocs = {
      order: parseOrder(orderSnap.id, orderSnap.data()),
      claim: parseClaim(claimSnap.id, claimSnap.data()),
      dispatch: dispatchSnap.exists() ? parseDispatch(dispatchSnap.id, dispatchSnap.data()) : null,
      handoff: handoffSnap.exists() ? parseHandoff(handoffSnap.id, handoffSnap.data()) : null,
    };
    if (docs.claim.orderId !== decision.orderId || docs.claim.claimId !== decision.claimId) {
      return { ok: false, kind: "unreadable", detail: "claim does not belong to this decision" };
    }
    return { ok: true, docs };
  } catch (e) {
    return { ok: false, kind: "unreadable", detail: e instanceof Error ? e.message : String(e) };
  }
}

// Flow E: the restaurant answers a hold with a counter photo. The engine decides the
// outcome (resolveCounterEvidence); this module only plans and writes it.
import { counterEvidenceCanHelp, resolveCounterEvidence } from "@fairclaim/engine";
import type { DispatchCheck, InferenceSource, Policy, Resolution } from "@fairclaim/schemas";
import { doc, serverTimestamp, writeBatch, type Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import type { DecisionDoc } from "./docs.ts";
import { toEngineDecision, toEngineInput, type CaseDocs } from "./engineInput.ts";
import { uploadOnce } from "./orders.ts";

export interface CounterPlan {
  resolution: Resolution;
  holdState: "resolved" | "escalated";
}

export class CounterError extends Error {}

/** False when the dispatch photo already proves what a counter photo could (the engine would send it to review). */
export function counterCanHelp(docs: CaseDocs, decision: DecisionDoc, policy: Policy): boolean {
  return counterEvidenceCanHelp(toEngineInput(docs, decision.review, policy));
}

export function planCounter(docs: CaseDocs, decision: DecisionDoc, policy: Policy, check: DispatchCheck): CounterPlan {
  if (decision.verdict !== "hold") throw new CounterError("Only held claims can be answered with counter-evidence.");
  if (decision.policyVersion !== policy.policyVersion) {
    throw new CounterError(`This claim was decided under policy ${decision.policyVersion}; this page loaded ${policy.policyVersion}. Reload and try again.`);
  }
  const resolution = resolveCounterEvidence(toEngineInput(docs, decision.review, policy), toEngineDecision(decision), check);
  return { resolution, holdState: resolution.outcome === "settled" ? "resolved" : "escalated" };
}

export const counterPhotoPath = (claimId: string) => `counter/${claimId}/photo.jpg`;

export interface CounterPhoto {
  blob: Blob;
  sha256: string;
  check: DispatchCheck;
  inferenceSource: InferenceSource;
}

/** Photo first (create-once), then one batch: counterEvidence + resolutions + hold state. */
export async function submitCounter(
  db: Firestore,
  storage: FirebaseStorage,
  restaurantId: string,
  decision: DecisionDoc,
  plan: CounterPlan,
  photo: CounterPhoto,
): Promise<void> {
  const id = decision.claimId;
  await uploadOnce(storage, counterPhotoPath(id), photo.blob, photo.sha256);
  const r = plan.resolution;
  const b = writeBatch(db);
  b.set(doc(db, "counterEvidence", id), {
    claimId: id,
    restaurantId,
    check: photo.check,
    inferenceSource: photo.inferenceSource,
    imageSha256: photo.sha256,
    photoRef: counterPhotoPath(id),
    recordedAt: serverTimestamp(),
  });
  b.set(doc(db, "resolutions", id), {
    claimId: id,
    restaurantId,
    customerId: decision.customerId,
    outcome: r.outcome,
    refundAmount: r.refundAmount,
    liability: r.liability,
    reasons: r.reasons,
    policyVersion: r.policyVersion,
    createdAt: serverTimestamp(),
  });
  b.update(doc(db, "holds", id), { state: plan.holdState, resolvedAt: serverTimestamp() });
  await b.commit();
}

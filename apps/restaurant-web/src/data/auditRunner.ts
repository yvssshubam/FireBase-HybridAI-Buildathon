// Replay audit (PLAN §22.2) for one decision: rebuild the engine input from the
// stored documents, run decide(), compare, check the crop hash, write audits/{id} once.
import { decide } from "@fairclaim/engine";
import type { Policy } from "@fairclaim/schemas";
import { doc, serverTimestamp, setDoc, type Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { auditOutcome, compareDecisions, unreadableOutcome, type AuditOutcome } from "./audit.ts";
import { loadCase } from "./case.ts";
import type { DecisionDoc } from "./docs.ts";
import { toEngineDecision, toEngineInput } from "./engineInput.ts";
import { loadImage } from "./images.ts";

export type AuditRun =
  | { status: "written"; outcome: AuditOutcome }
  | { status: "skipped"; reason: string; retry: boolean };

// storage.lifecycle.json deletes crops after 3 days; a missing crop after that is expected.
const RETENTION_MS = 3 * 24 * 3_600_000;

const code = (e: unknown) => (typeof e === "object" && e !== null && "code" in e ? String(e.code) : "");

async function cropMatches(storage: FirebaseStorage, cropRef: string, expected: string | null, decidedAt: number | null, now: number) {
  try {
    const img = await loadImage(storage, cropRef);
    return { ok: true as const, match: img.sha256 === expected };
  } catch (e) {
    if (code(e) === "storage/object-not-found") {
      const expired = decidedAt !== null && now - decidedAt > RETENTION_MS;
      return { ok: true as const, match: expired ? null : false };
    }
    return { ok: false as const, error: e };
  }
}

export async function auditDecision(
  db: Firestore,
  storage: FirebaseStorage,
  restaurantId: string,
  decision: DecisionDoc,
  policy: Policy,
  now: number,
): Promise<AuditRun> {
  // Rules force decisions to carry the current config/policy version; if ours differs
  // we can't replay faithfully, so wait for the matching policy instead of guessing.
  if (decision.policyVersion !== policy.policyVersion) {
    return { status: "skipped", reason: `decision uses policy ${decision.policyVersion}, this page has ${policy.policyVersion}`, retry: false };
  }
  const loaded = await loadCase(db, decision);
  let outcome: AuditOutcome;
  if (!loaded.ok) {
    if (loaded.kind === "claim_deleted") return { status: "skipped", reason: "the customer deleted this claim", retry: false };
    outcome = unreadableOutcome(loaded.detail);
  } else {
    const replay = decide(toEngineInput(loaded.docs, decision.review, policy));
    const fields = compareDecisions(toEngineDecision(decision), replay);
    let cropHashMatch: boolean | null = null;
    const { claim } = loaded.docs;
    if (claim.cropRef !== null) {
      const crop = await cropMatches(storage, claim.cropRef, claim.cropSha256, decision.createdAt, now);
      if (!crop.ok) {
        // Network/CORS trouble is not evidence of tampering: retry on the next load.
        const why = code(crop.error) || (crop.error instanceof Error ? crop.error.message : "download failed");
        return { status: "skipped", reason: `couldn't download the crop (${why}); check the bucket's CORS setup`, retry: true };
      }
      cropHashMatch = crop.match;
    }
    outcome = auditOutcome(fields, cropHashMatch);
  }
  try {
    await setDoc(doc(db, "audits", decision.claimId), {
      claimId: decision.claimId,
      restaurantId,
      match: outcome.match,
      mismatchFields: outcome.mismatchFields,
      cropHashMatch: outcome.cropHashMatch,
      policyVersion: policy.policyVersion,
      auditedAt: serverTimestamp(),
    });
  } catch (e) {
    // Create-once: another tab may have written it first; the listener will show that one.
    if (code(e) === "permission-denied") return { status: "skipped", reason: "already audited", retry: false };
    throw e;
  }
  return { status: "written", outcome };
}

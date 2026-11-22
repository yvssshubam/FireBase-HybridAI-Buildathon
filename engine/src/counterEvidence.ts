// Flow E: the restaurant answers a hold with a counter photo (checked like a
// dispatch photo: sealed, right code, no visible damage). Clear → settle with
// the policy share; anything else → human review. The customer's refund never
// changes here.
import type { DispatchCheck, EngineDecision, EngineInput, Resolution } from "@fairclaim/schemas";
import { classifyEvidence } from "./evidence.ts";
import { permilleOf } from "./money.ts";

export class EngineError extends Error {
  constructor(readonly code: "not_hold") {
    super(code);
  }
}

/**
 * False when the restaurant's own dispatch photo already proves everything a
 * counter photo could: the seal for missing/wrong items, a clean high-confidence
 * parcel for damage. Re-sending that proof must not shift the cost.
 */
export function counterEvidenceCanHelp(input: EngineInput): boolean {
  const dispatch = classifyEvidence(input).dispatch;
  if (dispatch === null) return true;
  return input.claim.issueType === "damaged" && dispatch.confidence !== "high";
}

export function resolveCounterEvidence(input: EngineInput, decision: EngineDecision, counter: DispatchCheck): Resolution {
  if (decision.verdict !== "hold") throw new EngineError("not_hold");
  const { order, claim, policy } = input;
  const refund = decision.refundAmount;
  const escalate = (reason: string): Resolution => ({
    outcome: "review",
    refundAmount: refund,
    liability: { restaurant: 0, transit: 0, platform: 0 },
    reasons: [reason],
    policyVersion: policy.policyVersion,
  });

  if (!counterEvidenceCanHelp(input)) return escalate("counter_evidence_repeats_dispatch");

  // Damage needs a clean-looking parcel; missing/wrong items can only be answered by the seal.
  const contentOk = claim.issueType !== "damaged" || !counter.spill_or_damage_visible;
  const clear = counter.seal_intact && order.sealCode !== null && counter.seal_code_read === order.sealCode && counter.confidence === "high" && contentOk;
  if (!clear) return escalate("counter_evidence_unclear");

  const restaurant = permilleOf(refund, policy.counterEvidence.restaurantPermilleAfterClear);
  return {
    outcome: "settled",
    refundAmount: refund,
    liability: { restaurant, transit: refund - restaurant, platform: 0 },
    reasons: ["counter_evidence_clear"],
    policyVersion: policy.policyVersion,
  };
}

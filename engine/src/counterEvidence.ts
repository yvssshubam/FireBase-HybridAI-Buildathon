// Flow E: the restaurant answers a hold with a counter photo (checked like a
// dispatch photo). Clear → settle with the policy share; anything else → human
// review. The customer's refund never changes here.
import type { DispatchCheck, EngineDecision, EngineInput, Resolution } from "@fairclaim/schemas";
import { classifyEvidence, itemStatuses } from "./evidence.ts";
import { namesMatch } from "./match.ts";
import { permilleOf } from "./money.ts";

export class EngineError extends Error {
  constructor(readonly code: "not_hold") {
    super(code);
  }
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

  // Packed, sealed at dispatch and sealed at handoff, yet missing: another photo can't explain that.
  if (decision.liabilityCase === "hold_investigate_contradiction") return escalate("counter_evidence_cannot_resolve_contradiction");

  // A late photo must not override the restaurant's own dispatch photo showing the item absent.
  const dispatch = classifyEvidence(input).dispatch;
  if (dispatch && claim.issueType !== "damaged" && itemStatuses(dispatch, order, claim.selectedItemIds).includes("absent")) {
    return escalate("counter_evidence_conflicts_dispatch");
  }

  const contentOk =
    claim.issueType === "damaged"
      ? !counter.spill_or_damage_visible
      : claim.selectedItemIds.every((id) => {
          const item = order.items.find((i) => i.id === id);
          return item !== undefined && counter.visible_items.some((v) => namesMatch(v, item.name));
        });
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

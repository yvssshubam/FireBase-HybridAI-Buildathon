// Firestore documents ↔ the TS reference engine (@fairclaim/engine).
import type { EngineDecision, EngineInput, Policy, ReviewInput } from "@fairclaim/schemas";
import type { ClaimDoc, DecisionDoc, DispatchDoc, HandoffDoc, OrderDoc } from "./docs.ts";

export interface CaseDocs {
  order: OrderDoc;
  dispatch: DispatchDoc | null;
  handoff: HandoffDoc | null;
  claim: ClaimDoc;
}

/** Rebuilds exactly what the customer's app fed its engine (PLAN §22.2 replay audit). */
export function toEngineInput(c: CaseDocs, review: ReviewInput, policy: Policy): EngineInput {
  const { order, claim } = c;
  return {
    order: { id: order.id, items: order.items.map((i) => ({ ...i })), total: order.total, sealCode: order.sealCode },
    dispatch: c.dispatch ? { check: c.dispatch.check } : null,
    handoff: c.handoff ? { check: c.handoff.check } : null,
    claim: {
      issueType: claim.issueType,
      selectedItemIds: [...claim.selectedItemIds],
      challenge: { ...claim.challenge },
      challengeCheck: claim.challengeCheck,
      damageCheck: claim.damageCheck,
      moireScore: claim.moireScore,
      customerClaims30d: claim.customerClaims30d,
    },
    review,
    policy,
  };
}

/** The stored decision in engine form (input to resolveCounterEvidence and the audit). */
export function toEngineDecision(d: DecisionDoc): EngineDecision {
  return {
    verdict: d.verdict,
    refundAmount: d.refundAmount,
    assessedAmount: d.assessedAmount,
    currency: d.currency,
    liability: { ...d.liability },
    liabilityCase: d.liabilityCase,
    split: d.split ? { ...d.split } : null,
    reasons: [...d.reasons],
    holdHours: d.holdHours,
    policyVersion: d.policyVersion,
  };
}

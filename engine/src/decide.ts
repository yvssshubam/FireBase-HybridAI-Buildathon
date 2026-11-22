// Deterministic decision: AI-produced evidence in, money out. No clock, no I/O.
import type { EngineDecision, EngineInput, Liability as Amounts } from "@fairclaim/schemas";
import { classifyEvidence } from "./evidence.ts";
import { gateFailures, itemConsistency, selectedItemsValid } from "./gate.ts";
import { assignLiability, holdSplit } from "./liability.ts";
import { permilleOf, rawAssessment } from "./money.ts";

const ZERO: Amounts = { restaurant: 0, transit: 0, platform: 0 };

export function decide(input: EngineInput): EngineDecision {
  const { order, policy, claim, review } = input;
  const ev = classifyEvidence(input);
  const reasons: string[] = [ev.dispatchFact, ev.handoffFact];
  const problems: string[] = [...gateFailures(input)];

  const itemsValid = selectedItemsValid(input);
  if (!itemsValid) problems.push("claim_items_invalid");
  else problems.push(...itemConsistency(input));

  let assessed = 0;
  const amountNotes: string[] = [];
  if (itemsValid) {
    const raw = rawAssessment(input);
    assessed = Math.min(raw, order.total);
    if (raw > order.total) amountNotes.push("refund_capped_at_order_total");
  }

  const risk: string[] = [];
  if (assessed > policy.autoApproveCap) risk.push("over_auto_approve_cap");
  if (claim.customerClaims30d >= policy.claimHistoryLimit30d) risk.push("claim_history_limit");

  const reviewNotes: string[] = [];
  if (review?.status === "unavailable") reviewNotes.push("cloud_review_unavailable");
  else if (review?.status === "ok" && (!review.consistent || review.flags.length > 0)) reviewNotes.push("cloud_review_flagged");

  const liability = itemsValid ? assignLiability(input, ev) : ({ kind: "undetermined", liabilityCase: "undetermined" } as const);
  reasons.push(...problems, ...amountNotes, ...risk, ...reviewNotes);

  const base = { assessedAmount: assessed, currency: "INR" as const, liabilityCase: liability.liabilityCase, reasons, policyVersion: policy.policyVersion };
  const flagged = problems.length > 0 || risk.length > 0 || reviewNotes.length > 0;

  if (flagged || liability.kind === "undetermined") {
    return { ...base, verdict: "review", refundAmount: 0, liability: { ...ZERO }, split: null, holdHours: null };
  }
  if (liability.kind === "clear") {
    return { ...base, verdict: "auto_refund", refundAmount: assessed, liability: { ...ZERO, [liability.party]: assessed }, split: null, holdHours: null };
  }
  const split = holdSplit(liability, policy);
  const restaurant = permilleOf(assessed, split.restaurantPermille);
  return {
    ...base,
    verdict: "hold",
    refundAmount: assessed,
    liability: { restaurant, transit: assessed - restaurant, platform: 0 },
    split,
    holdHours: policy.holdHours,
  };
}

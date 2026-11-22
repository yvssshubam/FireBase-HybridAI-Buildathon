// Claim outcomes, failed fraud checks and the action queue. Everything is derived
// from documents the restaurant can read; nothing here is a model output. Failed
// checks are the anti-fraud gate results the engine recorded as reason codes: they
// say the evidence didn't verify, not that the customer meant to cheat.
import type { ClaimDoc, OrderDoc } from "./docs.ts";
import type { DecisionView } from "./views.ts";

/** Gate reasons that point at fake, reused or staged evidence (PLAN §9 layers 2–5). */
export const FRAUD_SIGNALS = [
  "gate_code_mismatch",
  "gate_moire_high",
  "gate_screen_suspected",
  "gate_fingers_mismatch",
  "gate_window_expired",
  "gate_time_invalid",
] as const;
export type FraudSignal = (typeof FRAUD_SIGNALS)[number];
const FRAUD_SET: ReadonlySet<string> = new Set(FRAUD_SIGNALS);

export type Outcome = "refunded" | "pending" | "review";

/**
 * What happened to the customer's money for this claim, right now. An instant refund
 * the audit later flagged was still paid out, so it counts as refunded (and as tampered).
 */
export function outcomeOf(v: DecisionView): Outcome {
  const { decision: d, hold } = v;
  if (d.verdict === "review") return "review";
  if (d.verdict === "auto_refund") return "refunded";
  switch (hold?.state) {
    case "accepted":
    case "settled":
    case "resolved":
      return "refunded";
    case "escalated":
      return "review";
    default:
      return "pending"; // held, or the hold document hasn't arrived yet
  }
}

export function fraudSignalsOf(v: DecisionView): FraudSignal[] {
  return v.decision.reasons.filter((r): r is FraudSignal => FRAUD_SET.has(r));
}

/** Who ends up paying: the resolution's split once counter-evidence settled it, else the decision's. */
export function finalLiability(v: DecisionView) {
  return v.resolution?.outcome === "settled" ? v.resolution.liability : v.decision.liability;
}

export interface DashboardStats {
  filed: number;
  refunded: number;
  pending: number;
  review: number;
  failedChecks: number;
  tampered: number;
  passedChecks: number;
  refundedAmount: number;
  pendingAmount: number;
  /** What all-or-nothing refunds would have cost for the same refunded claims. */
  fullOrderAmount: number;
  savedAmount: number;
  paidBy: { restaurant: number; transit: number; platform: number };
  signals: { code: FraudSignal; count: number }[];
  /** Model checks that ran on-device vs in the cloud, from the claims loaded so far. */
  inference: { onDevice: number; inCloud: number; claimsCounted: number };
}

export function computeStats(
  views: readonly DecisionView[],
  orders: ReadonlyMap<string, OrderDoc>,
  claims: ReadonlyMap<string, ClaimDoc>,
): DashboardStats {
  const s: DashboardStats = {
    filed: views.length,
    refunded: 0,
    pending: 0,
    review: 0,
    failedChecks: 0,
    tampered: 0,
    passedChecks: 0,
    refundedAmount: 0,
    pendingAmount: 0,
    fullOrderAmount: 0,
    savedAmount: 0,
    paidBy: { restaurant: 0, transit: 0, platform: 0 },
    signals: [],
    inference: { onDevice: 0, inCloud: 0, claimsCounted: 0 },
  };
  const signalCounts = new Map<FraudSignal, number>();
  for (const v of views) {
    const outcome = outcomeOf(v);
    const signals = fraudSignalsOf(v);
    if (signals.length > 0) s.failedChecks++;
    else s.passedChecks++;
    for (const sig of new Set(signals)) signalCounts.set(sig, (signalCounts.get(sig) ?? 0) + 1);
    if (v.audit?.match === false) s.tampered++;
    if (outcome === "refunded") {
      s.refunded++;
      s.refundedAmount += v.decision.refundAmount;
      const paid = finalLiability(v);
      s.paidBy.restaurant += paid.restaurant;
      s.paidBy.transit += paid.transit;
      s.paidBy.platform += paid.platform;
      const order = orders.get(v.decision.orderId);
      if (order) {
        s.fullOrderAmount += order.total;
        s.savedAmount += order.total - v.decision.refundAmount;
      }
    } else if (outcome === "pending") {
      s.pending++;
      s.pendingAmount += v.decision.refundAmount;
    } else {
      s.review++;
    }
    const claim = claims.get(v.decision.claimId);
    if (claim) {
      s.inference.claimsCounted++;
      for (const src of [claim.inferenceSources.challenge, claim.inferenceSources.damage]) {
        if (src === "ON_DEVICE") s.inference.onDevice++;
        else if (src === "IN_CLOUD") s.inference.inCloud++;
      }
    }
  }
  s.signals = [...signalCounts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
  return s;
}

export type ActionItem =
  | { kind: "respond"; view: DecisionView; deadline: number }
  | { kind: "review"; view: DecisionView; since: number | null };

/**
 * Work that needs a person. "respond": open holds the restaurant can accept or answer
 * (most urgent first). "review": claims waiting for a platform reviewer (oldest first).
 */
export function actionQueue(views: readonly DecisionView[], now: number): { respond: ActionItem[]; review: ActionItem[] } {
  const respond: ActionItem[] = [];
  const review: ActionItem[] = [];
  for (const v of views) {
    const h = v.hold;
    if (v.tab !== "review" && h?.state === "held" && h.createdAt !== null) {
      const deadline = h.createdAt + h.holdHours * 3_600_000;
      if (deadline > now) respond.push({ kind: "respond", view: v, deadline });
    }
    if (v.tab === "review") review.push({ kind: "review", view: v, since: v.decision.createdAt });
  }
  respond.sort((a, b) => (a.kind === "respond" && b.kind === "respond" ? a.deadline - b.deadline : 0));
  review.sort((a, b) => (a.kind === "review" && b.kind === "review" ? (a.since ?? 0) - (b.since ?? 0) : 0));
  return { respond, review };
}

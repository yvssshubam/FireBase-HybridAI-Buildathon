import { describe, expect, it } from "vitest";
import type { AuditDoc, ClaimDoc, DecisionDoc, HoldDoc, OrderDoc, ResolutionDoc } from "../src/data/docs.ts";
import { actionQueue, computeStats, fraudSignalsOf, outcomeOf } from "../src/data/stats.ts";
import { classify } from "../src/data/views.ts";
import { urgentItems } from "../src/data/urgent.ts";

const H = 3_600_000;
const NOW = 1_700_000_000_000;

function decision(id: string, over: Partial<DecisionDoc> = {}): DecisionDoc {
  return {
    claimId: id,
    orderId: `o-${id}`,
    customerId: "cust",
    restaurantId: "rest",
    verdict: "auto_refund",
    refundAmount: 100,
    assessedAmount: 100,
    currency: "INR",
    liability: { restaurant: 0, transit: 100, platform: 0 },
    liabilityCase: "handling_damage",
    split: null,
    reasons: ["dispatch_valid", "handoff_intact"],
    holdHours: null,
    review: { status: "ok", consistent: true, flags: [] },
    explanationRestaurant: "",
    engine: "kotlin",
    policyVersion: "v1",
    createdAt: NOW - H,
    ...over,
  };
}
const hold = (id: string, state: HoldDoc["state"], createdAt = NOW - H): HoldDoc => ({
  claimId: id,
  customerId: "cust",
  restaurantId: "rest",
  amount: 100,
  parties: { restaurant: 30, transit: 70, platform: 0 },
  state,
  holdHours: 48,
  createdAt,
  resolvedAt: null,
});
const audit = (id: string, match: boolean) => ({ claimId: id, match, mismatchFields: match ? [] : ["verdict"], cropHashMatch: null, policyVersion: "v1", auditedAt: NOW }) as AuditDoc;

const heldDecision = (id: string) => decision(id, { verdict: "hold", liability: { restaurant: 30, transit: 70, platform: 0 }, holdHours: 48, liabilityCase: "hold_no_handoff" });
const reviewDecision = (id: string, reasons: string[], over: Partial<DecisionDoc> = {}) =>
  decision(id, { verdict: "review", refundAmount: 0, liability: { restaurant: 0, transit: 0, platform: 0 }, reasons, ...over });

describe("outcomeOf", () => {
  it("instant refund → refunded, even if the audit later flags it", () => {
    expect(outcomeOf(classify(decision("a"), null, null, null))).toBe("refunded");
    expect(outcomeOf(classify(decision("a"), null, null, audit("a", false)))).toBe("refunded");
  });
  it("hold: open → pending; accepted/settled/resolved → refunded; escalated → review", () => {
    expect(outcomeOf(classify(heldDecision("h"), hold("h", "held"), null, null))).toBe("pending");
    expect(outcomeOf(classify(heldDecision("h"), null, null, null))).toBe("pending");
    for (const s of ["accepted", "settled", "resolved"] as const) {
      expect(outcomeOf(classify(heldDecision("h"), hold("h", s), null, null))).toBe("refunded");
    }
    expect(outcomeOf(classify(heldDecision("h"), hold("h", "escalated"), { outcome: "review" } as ResolutionDoc, null))).toBe("review");
  });
  it("review verdict → review", () => {
    expect(outcomeOf(classify(reviewDecision("r", ["gate_moire_high"]), null, null, null))).toBe("review");
  });
});

describe("fraud signals", () => {
  it("counts only anti-fraud gate failures, not low confidence or unclear crops", () => {
    const v = classify(reviewDecision("r", ["dispatch_valid", "gate_code_mismatch", "gate_challenge_low_confidence", "gate_moire_high", "damage_none_on_crop"]), null, null, null);
    expect(fraudSignalsOf(v)).toEqual(["gate_code_mismatch", "gate_moire_high"]);
  });
});

const order = (id: string, total: number) => ({ id, total }) as OrderDoc;

describe("computeStats", () => {
  const views = [
    classify(decision("a", { refundAmount: 108, liability: { restaurant: 0, transit: 108, platform: 0 } }), null, null, audit("a", true)),
    classify(heldDecision("h1"), hold("h1", "held"), null, null),
    classify(heldDecision("h2"), hold("h2", "resolved"), { outcome: "settled", liability: { restaurant: 0, transit: 100, platform: 0 } } as ResolutionDoc, null),
    classify(reviewDecision("r1", ["gate_code_mismatch", "gate_moire_high"]), null, null, null),
    classify(reviewDecision("r2", ["gate_screen_suspected"]), null, null, null),
    classify(decision("t", { liability: { restaurant: 100, transit: 0, platform: 0 } }), null, null, audit("t", false)),
  ];
  const orders = new Map([
    ["o-a", order("o-a", 560)],
    ["o-h2", order("o-h2", 300)],
    ["o-t", order("o-t", 200)],
  ]);
  const claims = new Map<string, ClaimDoc>([
    ["a", { inferenceSources: { challenge: "ON_DEVICE", damage: "ON_DEVICE" } } as ClaimDoc],
    ["r1", { inferenceSources: { challenge: "IN_CLOUD", damage: null } } as ClaimDoc],
  ]);
  const s = computeStats(views, orders, claims);

  it("counts claims by outcome", () => {
    expect(s).toMatchObject({ filed: 6, refunded: 3, pending: 1, review: 2, failedChecks: 2, passedChecks: 4, tampered: 1 });
    expect(s.refunded + s.pending + s.review).toBe(s.filed);
  });
  it("sums money, using the settled split after counter-evidence", () => {
    expect(s.refundedAmount).toBe(108 + 100 + 100);
    expect(s.pendingAmount).toBe(100);
    expect(s.paidBy).toEqual({ restaurant: 100, transit: 108 + 100, platform: 0 });
  });
  it("compares with all-or-nothing refunds of the same orders", () => {
    expect(s.fullOrderAmount).toBe(560 + 300 + 200);
    expect(s.savedAmount).toBe(560 - 108 + (300 - 100) + (200 - 100));
  });
  it("ranks the failed checks", () => {
    expect(s.signals).toEqual([
      { code: "gate_code_mismatch", count: 1 },
      { code: "gate_moire_high", count: 1 },
      { code: "gate_screen_suspected", count: 1 },
    ]);
  });
  it("counts on-device vs cloud model checks from the loaded claims", () => {
    expect(s.inference).toEqual({ onDevice: 2, inCloud: 1, claimsCounted: 2 });
  });
  it("is all zeros with no claims", () => {
    expect(computeStats([], new Map(), new Map())).toMatchObject({ filed: 0, refunded: 0, savedAmount: 0, signals: [] });
  });
});

describe("actionQueue", () => {
  it("open holds by deadline, review items oldest first; expired holds drop out", () => {
    const views = [
      classify(heldDecision("late"), hold("late", "held", NOW - 40 * H), null, null),
      classify(heldDecision("soon"), hold("soon", "held", NOW - 47 * H), null, null),
      classify(heldDecision("gone"), hold("gone", "held", NOW - 49 * H), null, null),
      classify(heldDecision("done"), hold("done", "accepted"), null, null),
      classify(reviewDecision("r-new", []), null, null, null),
      classify(reviewDecision("r-old", [], { createdAt: NOW - 10 * H }), null, null, null),
      classify(decision("bad"), null, null, audit("bad", false)),
    ];
    const q = actionQueue(views, NOW);
    expect(q.respond.map((i) => i.view.decision.claimId)).toEqual(["soon", "late"]);
    expect(q.review.map((i) => i.view.decision.claimId)).toEqual(["r-old", "r-new", "bad"]);
  });
});

describe("urgentItems (Overview)", () => {
  const placed = (id: string, createdAt: number) => ({ id, status: "placed", createdAt }) as OrderDoc;
  it("orders by urgency: holds settling soon, orders to pack, failed re-checks, other holds; reviews left out", () => {
    const views = [
      classify(heldDecision("later"), hold("later", "held", NOW - 10 * H), null, null),
      classify(heldDecision("soon"), hold("soon", "held", NOW - 45 * H), null, null),
      classify(reviewDecision("fraud", ["gate_code_mismatch"]), null, null, null),
      classify(decision("bad"), null, null, audit("bad", false)),
      classify(decision("fine"), null, null, audit("fine", true)),
    ];
    const orders = [placed("new", NOW - 60_000), placed("old", NOW - 600_000), { id: "gone", status: "delivered", createdAt: NOW } as OrderDoc];
    const items = urgentItems(actionQueue(views, NOW).respond, views, orders, NOW);
    expect(items.map((i) => (i.kind === "pack" ? `pack:${i.order.id}` : `${i.kind}:${i.view.decision.claimId}`))).toEqual([
      "hold_soon:soon",
      "pack:old",
      "pack:new",
      "mismatch:bad",
      "hold:later",
    ]);
  });
  it("is empty when nothing needs the restaurant", () => {
    expect(urgentItems([], [classify(decision("ok"), null, null, audit("ok", true))], [], NOW)).toEqual([]);
  });
});

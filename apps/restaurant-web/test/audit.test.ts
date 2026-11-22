import type { EngineDecision } from "@fairclaim/schemas";
import { describe, expect, it } from "vitest";
import { auditOutcome, compareDecisions, unreadableOutcome } from "../src/data/audit.ts";
import { classify } from "../src/data/views.ts";
import type { AuditDoc, DecisionDoc, HoldDoc, ResolutionDoc } from "../src/data/docs.ts";

const base: EngineDecision = {
  verdict: "auto_refund",
  refundAmount: 108,
  assessedAmount: 108,
  currency: "INR",
  liability: { restaurant: 0, transit: 108, platform: 0 },
  liabilityCase: "handling_damage",
  split: null,
  reasons: ["dispatch_valid", "handoff_intact"],
  holdHours: null,
  policyVersion: "v1",
};

describe("compareDecisions", () => {
  it("identical decisions match", () => {
    expect(compareDecisions(base, structuredClone(base))).toEqual([]);
  });

  it("flags a hand-edited refund (§22.6: replay audit flags a hand-edited decision)", () => {
    const edited = { ...base, refundAmount: 180, liability: { restaurant: 0, transit: 180, platform: 0 } };
    expect(compareDecisions(edited, base)).toEqual(["refundAmount", "liability.transit"]);
  });

  it("flags a verdict upgrade", () => {
    expect(compareDecisions({ ...base, verdict: "auto_refund" }, { ...base, verdict: "review", refundAmount: 0, liability: { restaurant: 0, transit: 0, platform: 0 } })).toEqual([
      "verdict",
      "refundAmount",
      "liability.transit",
    ]);
  });

  it("flags liability shifted between parties even when the total is the same", () => {
    expect(compareDecisions({ ...base, liability: { restaurant: 108, transit: 0, platform: 0 } }, base)).toEqual(["liability.restaurant", "liability.transit"]);
  });

  it("reasons must match in order", () => {
    expect(compareDecisions({ ...base, reasons: ["handoff_intact", "dispatch_valid"] }, base)).toEqual(["reasons"]);
    expect(compareDecisions({ ...base, reasons: ["dispatch_valid"] }, base)).toEqual(["reasons"]);
  });
});

describe("auditOutcome", () => {
  it("match only when fields agree and the crop isn't contradicted", () => {
    expect(auditOutcome([], true)).toEqual({ match: true, mismatchFields: [], cropHashMatch: true });
    expect(auditOutcome([], null)).toEqual({ match: true, mismatchFields: [], cropHashMatch: null });
    expect(auditOutcome([], false)).toEqual({ match: false, mismatchFields: ["cropSha256"], cropHashMatch: false });
    expect(auditOutcome(["verdict"], true).match).toBe(false);
  });

  it("caps mismatchFields at 20 (rules limit)", () => {
    expect(auditOutcome(Array.from({ length: 30 }, (_, i) => `f${i}`), false).mismatchFields).toHaveLength(20);
  });

  it("an unreadable document is a mismatch", () => {
    const o = unreadableOutcome("claims/c1.moireScore: expected a number");
    expect(o.match).toBe(false);
    expect(o.mismatchFields[0]).toMatch(/^unreadable:/);
  });
});

describe("decision tabs", () => {
  const decision = { claimId: "c1", verdict: "auto_refund", createdAt: 1 } as DecisionDoc;
  const hold = (state: HoldDoc["state"]) => ({ state }) as HoldDoc;
  const audit = (match: boolean) => ({ match }) as AuditDoc;

  it("auto refund → Auto-refunded", () => {
    expect(classify(decision, null, null, audit(true)).tab).toBe("auto");
  });
  it("audit mismatch moves any decision to Needs review", () => {
    const v = classify(decision, null, null, audit(false));
    expect(v.tab).toBe("review");
    expect(v.reviewBecause).toEqual(["audit_mismatch"]);
  });
  it("hold → On hold; escalated hold → Needs review", () => {
    const d = { ...decision, verdict: "hold" } as DecisionDoc;
    expect(classify(d, hold("held"), null, null).tab).toBe("hold");
    expect(classify(d, hold("resolved"), { outcome: "settled" } as ResolutionDoc, null).tab).toBe("hold");
    expect(classify(d, hold("escalated"), { outcome: "review" } as ResolutionDoc, null).reviewBecause).toEqual(["escalated"]);
  });
  it("review verdict → Needs review", () => {
    expect(classify({ ...decision, verdict: "review" } as DecisionDoc, null, null, null).reviewBecause).toEqual(["review_verdict"]);
  });
});

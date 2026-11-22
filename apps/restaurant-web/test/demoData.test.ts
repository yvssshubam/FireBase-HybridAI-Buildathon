// The dev-only demo data must look like real data: every stored decision is what the
// engine produces from its stored evidence (except the one deliberately tampered).
import { decide } from "@fairclaim/engine";
import { defaultPolicy } from "@fairclaim/schemas";
import { describe, expect, it } from "vitest";
import { compareDecisions } from "../src/data/audit.ts";
import { toEngineDecision, toEngineInput } from "../src/data/engineInput.ts";
import { fraudSignalsOf, outcomeOf } from "../src/data/stats.ts";
import { buildViews } from "../src/data/views.ts";
import { buildDemoData } from "../src/demo/demoData.ts";

describe("demo data (dev only)", () => {
  const d = buildDemoData("rest-1", 1_700_000_000_000);
  const views = buildViews(d.decisions, d.holds, d.resolutions, d.audits);

  it("replays to the stored decision for every claim except the one tampered one", () => {
    const diffs = [...d.decisions].map(([id, dec]) => {
      const c = d.cases.get(id);
      if (!c) throw new Error(`no case for ${id}`);
      return compareDecisions(toEngineDecision(dec), decide(toEngineInput(c, dec.review, defaultPolicy)));
    });
    expect(diffs.filter((x) => x.length > 0)).toEqual([["liability.restaurant", "liability.transit"]]);
    // ...and that's the one whose audit says mismatch.
    expect([...d.audits.values()].filter((a) => !a.match)).toHaveLength(1);
  });

  it("covers every outcome and page", () => {
    const outcomes = new Set(views.map(outcomeOf));
    expect(outcomes).toEqual(new Set(["refunded", "pending", "review"]));
    expect(views.filter((v) => fraudSignalsOf(v).length > 0).length).toBeGreaterThanOrEqual(3);
    expect(views.filter((v) => v.audit?.match === false)).toHaveLength(1);
    const sources = [...d.claims.values()].map((c) => c.inferenceSources.challenge);
    expect(sources).toContain("ON_DEVICE");
    expect(sources).toContain("IN_CLOUD");
    expect(views.filter((v) => v.hold?.state === "held")).toHaveLength(3);
  });

  it("every claim has its order and case documents", () => {
    for (const id of d.decisions.keys()) {
      const c = d.cases.get(id);
      expect(c?.claim.claimId).toBe(id);
      expect(d.orders.some((o) => o.id === c?.order.id)).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { analytics, dayStarts, startOfDay } from "../src/data/analytics.ts";
import type { ClaimDoc, DecisionDoc, HoldDoc, OrderDoc } from "../src/data/docs.ts";
import { classify } from "../src/data/views.ts";

// Local wall-clock times, so the test means the same in any time zone.
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0, 0, 0).getTime();
const NOW = at(22, 15);

function decision(id: string, createdAt: number, over: Partial<DecisionDoc> = {}): DecisionDoc {
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
    createdAt,
    ...over,
  };
}
const order = (id: string, createdAt: number, items: { id: string; name: string }[] = [{ id: "b", name: "Chicken Biryani" }]) =>
  ({ id, createdAt, total: 400, items: items.map((i) => ({ ...i, price: 200 })) }) as OrderDoc;
const claim = (id: string, selected: string[]) => ({ claimId: id, selectedItemIds: selected, inferenceSources: { challenge: "ON_DEVICE", damage: null } }) as ClaimDoc;
const held = (id: string): HoldDoc => ({
  claimId: id,
  customerId: "cust",
  restaurantId: "rest",
  amount: 100,
  parties: { restaurant: 50, transit: 50, platform: 0 },
  state: "held",
  holdHours: 48,
  createdAt: NOW - 3_600_000,
  resolvedAt: null,
});

describe("dayStarts", () => {
  it("returns local midnights, oldest first, ending today", () => {
    const d = dayStarts(NOW, 7);
    expect(d).toHaveLength(7);
    expect(d[6]).toBe(startOfDay(NOW));
    expect(d[0]).toBe(at(16, 0));
    for (const t of d) expect(new Date(t).getHours()).toBe(0);
  });
});

describe("analytics", () => {
  const views = [
    classify(decision("today", at(22, 9)), null, null, null),
    classify(decision("held", at(21, 20), { verdict: "hold", liabilityCase: "hold_no_handoff", liability: { restaurant: 50, transit: 50, platform: 0 }, holdHours: 48 }), held("held"), null, null),
    classify(
      decision("fraud", at(20, 11), { verdict: "review", refundAmount: 0, assessedAmount: 380, liability: { restaurant: 0, transit: 0, platform: 0 }, reasons: ["gate_code_mismatch"] }),
      null,
      null,
      null,
    ),
    classify(decision("old", at(10, 12)), null, null, null),
  ];
  const orders = [
    order("o-today", at(22, 8)),
    order("o-held", at(21, 19), [
      { id: "b", name: "Chicken Biryani" },
      { id: "r", name: "Raita" },
    ]),
    order("o-fraud", at(20, 10)),
    order("o-old", at(10, 11)),
    order("quiet", at(19, 13)),
  ];
  const claims = new Map([
    ["today", claim("today", ["b"])],
    ["held", claim("held", ["r"])],
    ["fraud", claim("fraud", ["b"])],
    ["old", claim("old", ["b"])],
  ]);
  const a = analytics(views, orders, claims, NOW, 7);

  it("keeps only claims and orders inside the period", () => {
    expect(a.stats.filed).toBe(3);
    expect(a.orders).toBe(4);
    expect(a.from).toBe(at(16, 0));
  });
  it("buckets each claim on its local day by outcome", () => {
    const byDay = Object.fromEntries(a.days.map((d) => [new Date(d.start).getDate(), [d.refunded, d.pending, d.review]]));
    expect(byDay[22]).toEqual([1, 0, 0]);
    expect(byDay[21]).toEqual([0, 1, 0]);
    expect(byDay[20]).toEqual([0, 0, 1]);
    expect(byDay[16]).toEqual([0, 0, 0]);
    expect(a.days.reduce((t, d) => t + d.refunded + d.pending + d.review, 0)).toBe(a.stats.filed);
  });
  it("counts claims blocked by an anti-fraud check and the amount not paid", () => {
    expect(a.blocked).toEqual({ claims: 1, amount: 380 });
  });
  it("ranks claimed items, counting refunds only when paid", () => {
    expect(a.topItems).toEqual([
      { name: "Chicken Biryani", claims: 2, refunded: 100 },
      { name: "Raita", claims: 1, refunded: 0 },
    ]);
  });
  it("is empty but well-formed with no data", () => {
    const e = analytics([], [], new Map(), NOW, 14);
    expect(e.days).toHaveLength(14);
    expect(e.stats.filed).toBe(0);
    expect(e.topItems).toEqual([]);
    expect(e.blocked).toEqual({ claims: 0, amount: 0 });
  });
});

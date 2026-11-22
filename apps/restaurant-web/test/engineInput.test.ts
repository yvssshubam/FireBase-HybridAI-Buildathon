// Firestore documents → EngineInput must reproduce exactly what the engine saw.
// Every shared engine vector is turned into the documents the Android app would
// write, parsed back with the web parsers, and replayed.
import { decide } from "@fairclaim/engine";
import { defaultPolicy, type DispatchCheck, type EngineDecision, type EngineInput, type Policy } from "@fairclaim/schemas";
import { Timestamp } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { planCounter } from "../src/data/counter.ts";
import { parseClaim, parseDecision, parseDispatch, parseHandoff, parseOrder } from "../src/data/docs.ts";
import { toEngineDecision, toEngineInput, type CaseDocs } from "../src/data/engineInput.ts";
import { DocError } from "../src/data/read.ts";

const require = createRequire(import.meta.url);
const load = <T>(name: string): T => JSON.parse(readFileSync(require.resolve(`@fairclaim/schemas/test-vectors/${name}`), "utf8")) as T;

type VectorInput = Omit<EngineInput, "policy">;
interface EngineVector {
  name: string;
  policyPatch?: Partial<Policy>;
  input: VectorInput;
  expected: EngineDecision;
}
interface CounterVector extends EngineVector {
  counterCheck: DispatchCheck;
  expected: EngineDecision & { outcome: string };
}

const ts = Timestamp.fromMillis(1_700_000_100_000);
const SHA = "a".repeat(64);

/** The documents the customer's app and the restaurant app would have stored for this input. */
function storedDocs(v: VectorInput, claimId = "claim-1"): CaseDocs {
  const o = v.order;
  const order = parseOrder(o.id, {
    restaurantId: "rest-1",
    customerId: "cust-1",
    items: o.items,
    itemIds: o.items.map((i) => i.id),
    total: o.total,
    status: o.sealCode === null ? "placed" : "delivered",
    sealCode: o.sealCode,
    createdAt: ts,
    dispatchedAt: o.sealCode === null ? null : ts,
    deliveredAt: null,
  });
  const dispatch = v.dispatch
    ? parseDispatch(o.id, { check: v.dispatch.check, inferenceSource: "ON_DEVICE", imageSha256: SHA, thumbRef: null, capturedAt: 1_700_000_000_000, recordedAt: ts })
    : null;
  const handoff = v.handoff ? parseHandoff(o.id, { check: v.handoff.check, inferenceSource: "IN_CLOUD", capturedAt: 1_700_000_000_500, recordedAt: ts }) : null;
  const c = v.claim;
  const hasCrop = c.issueType !== "missing";
  const claim = parseClaim(claimId, {
    claimId,
    orderId: o.id,
    customerId: "cust-1",
    ...c,
    cropSha256: hasCrop ? SHA : null,
    cropRef: hasCrop ? `claims/${claimId}/crop.jpg` : null,
    inferenceSources: { challenge: "ON_DEVICE", damage: hasCrop ? "ON_DEVICE" : null },
    createdAt: ts,
  });
  return { order, dispatch, handoff, claim };
}

const engineVectors = load<EngineVector[]>("engine.vectors.json");
// Stored decisions always carry the cloud review result; null-review vectors are preliminary-only.
const stored = engineVectors.filter((v) => v.input.review !== null);

describe("Firestore → EngineInput (replay of shared vectors)", () => {
  it("covers most vectors", () => {
    expect(stored.length).toBeGreaterThan(engineVectors.length * 0.8);
  });

  it.each(stored.map((v) => [v.name, v] as const))("%s", (_, v) => {
    const policy = { ...defaultPolicy, ...v.policyPatch };
    const docs = storedDocs(v.input);
    const review = v.input.review;
    if (review === null) throw new Error("filtered above");
    const input = toEngineInput(docs, review, policy);
    expect(input).toEqual({ ...v.input, policy });
    expect(decide(input)).toEqual(v.expected);
  });
});

describe("decision document ↔ EngineDecision", () => {
  it.each(stored.slice(0, 20).map((v) => [v.name, v] as const))("%s round-trips", (_, v) => {
    const e = v.expected;
    const doc = {
      claimId: "claim-1",
      orderId: v.input.order.id,
      customerId: "cust-1",
      restaurantId: "rest-1",
      ...e,
      review: v.input.review,
      explanations: { customer_en: "x", customer_hi: "", customer_ta: "", restaurant: "y" },
      engine: "kotlin",
      createdAt: ts,
    };
    const parsed = parseDecision("claim-1", doc);
    expect(toEngineDecision(parsed)).toEqual(e);
    expect(parsed.explanationRestaurant).toBe("y");
    expect(parsed.createdAt).toBe(1_700_000_100_000);
  });
});

describe("parsers reject tampered or malformed documents", () => {
  const v = stored[0];
  if (!v) throw new Error("no vectors");
  it("unknown inference source", () => {
    expect(() => parseDispatch("o", { check: v.input.dispatch?.check, inferenceSource: "SERVER", imageSha256: SHA, thumbRef: null, capturedAt: 1 })).toThrow(DocError);
  });
  it("model output that fails the schema", () => {
    expect(() => parseHandoff("o", { check: { seal_state: "open", seal_code_read: "4721", confidence: "high" }, inferenceSource: "ON_DEVICE", capturedAt: 1 })).toThrow(
      DocError,
    );
  });
  const rawOrder = { restaurantId: "r", customerId: "c", items: [{ id: "a", name: "A", price: 10 }], total: 10, status: "placed", sealCode: null, createdAt: ts };
  it("fractional money", () => {
    expect(parseOrder("o", rawOrder).total).toBe(10);
    expect(() => parseOrder("o", { ...rawOrder, items: [{ id: "a", name: "A", price: 10.5 }] })).toThrow(DocError);
  });
  it("timestamps are exact whole ms (Math.floor(toMillis()) would round 1700000000.999999 s up)", () => {
    const d = parseOrder("o", { ...rawOrder, createdAt: new Timestamp(1_700_000_000, 999_999) });
    expect(d.createdAt).toBe(1_700_000_000_000);
  });
  it("a client-written number is not a timestamp", () => {
    expect(() => parseOrder("o", { ...rawOrder, createdAt: 1_700_000_000_000 })).toThrow(DocError);
  });
});

describe("counter-evidence through stored documents (shared vectors)", () => {
  const counter = load<CounterVector[]>("counter-evidence.vectors.json");
  it.each(counter.map((v) => [v.name, v] as const))("%s", (_, v) => {
    const policy = { ...defaultPolicy, ...v.policyPatch };
    const review = v.input.review ?? { status: "ok", consistent: true, flags: [] };
    const docs = storedDocs(v.input);
    const decision = decide(toEngineInput(docs, review, policy));
    const decisionDoc = parseDecision("claim-1", {
      claimId: "claim-1",
      orderId: v.input.order.id,
      customerId: "cust-1",
      restaurantId: "rest-1",
      ...decision,
      review,
      explanations: { customer_en: "", customer_hi: "", customer_ta: "", restaurant: "" },
      engine: "kotlin",
      createdAt: ts,
    });
    if (decision.verdict !== "hold") {
      expect(() => planCounter(docs, decisionDoc, policy, v.counterCheck)).toThrow();
      return;
    }
    const plan = planCounter(docs, decisionDoc, policy, v.counterCheck);
    expect(plan.resolution).toEqual(v.expected);
    expect(plan.holdState).toBe(plan.resolution.outcome === "settled" ? "resolved" : "escalated");
  });

  it("refuses to plan under a different policy version", () => {
    const v = counter[0];
    if (!v) throw new Error("no counter vectors");
    const docs = storedDocs(v.input);
    const review = v.input.review ?? { status: "ok" as const, consistent: true, flags: [] };
    const decision = decide(toEngineInput(docs, review, defaultPolicy));
    const decisionDoc = parseDecision("claim-1", {
      claimId: "claim-1",
      orderId: v.input.order.id,
      customerId: "cust-1",
      restaurantId: "rest-1",
      ...decision,
      review,
      explanations: { customer_en: "", customer_hi: "", customer_ta: "", restaurant: "" },
      engine: "kotlin",
      createdAt: ts,
    });
    expect(() => planCounter(docs, decisionDoc, { ...defaultPolicy, policyVersion: "v2" }, v.counterCheck)).toThrow(/policy/);
  });
});

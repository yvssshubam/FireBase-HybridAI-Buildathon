import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  ago,
  claimBatch,
  claimDoc,
  createChallenge,
  CUST,
  decisionDoc,
  dispatchCheck,
  fs,
  holdDecision,
  holdDoc,
  ITEMS,
  MALLORY,
  MENU,
  PAIR,
  REST,
  REST2,
  SEAL,
  seedBase,
  seedClaim,
  seedHold,
  setup,
  SHA,
} from "./helpers.ts";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedBase(env);
});

const as = (uid: string) => fs(env.authenticatedContext(uid));
const anon = () => fs(env.unauthenticatedContext());
const sameUtcDay = (a: number, b: number) => new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

describe("users / terms acceptance (§23)", () => {
  it("a user records their own acceptance", async () => {
    await assertSucceeds(setDoc(doc(as(CUST), `users/${CUST}`), { termsVersion: "v1", acceptedAt: serverTimestamp(), role: "customer" }));
  });
  it("cannot write someone else's user doc", async () => {
    await assertFails(setDoc(doc(as(MALLORY), `users/${CUST}`), { termsVersion: "v1", acceptedAt: serverTimestamp(), role: "customer" }));
  });
  it("acceptance time must be the server time", async () => {
    await assertFails(setDoc(doc(as(CUST), `users/${CUST}`), { termsVersion: "v1", acceptedAt: ago(1000), role: "customer" }));
  });
  it("signed-out requests are rejected", async () => {
    await assertFails(getDoc(doc(anon(), "config/policy")));
  });
});

describe("restaurants + pairing", () => {
  it("a web session creates its sandbox restaurant and pair code together", async () => {
    const db = as("rest9");
    const b = writeBatch(db);
    b.set(doc(db, "restaurants/rest9"), { name: "Demo Kitchen", pairCode: "QWE234", menu: MENU, createdAt: serverTimestamp() });
    b.set(doc(db, "pairCodes/QWE234"), { restaurantId: "rest9" });
    await assertSucceeds(b.commit());
  });
  it("cannot create a restaurant under another uid", async () => {
    const db = as(MALLORY);
    const b = writeBatch(db);
    b.set(doc(db, "restaurants/rest9"), { name: "Fake", pairCode: "QWE234", menu: MENU, createdAt: serverTimestamp() });
    b.set(doc(db, "pairCodes/QWE234"), { restaurantId: "rest9" });
    await assertFails(b.commit());
  });
  it("cannot take over an existing pair code", async () => {
    await assertFails(setDoc(doc(as(MALLORY), `pairCodes/${PAIR}`), { restaurantId: MALLORY }));
  });
  it("pair code lookup by code works, listing codes does not", async () => {
    await assertSucceeds(getDoc(doc(as(CUST), `pairCodes/${PAIR}`)));
    await assertFails(getDocs(collection(as(CUST), "pairCodes")));
    await assertFails(getDocs(collection(as(CUST), "restaurants")));
  });
});

describe("orders", () => {
  const order = (over: Record<string, unknown> = {}) => ({
    restaurantId: REST,
    customerId: CUST,
    items: ITEMS,
    itemIds: ITEMS.map((i) => i.id),
    total: 560,
    status: "placed",
    sealCode: null,
    createdAt: serverTimestamp(),
    ...over,
  });
  it("customer places an order from the menu", async () => {
    await assertSucceeds(setDoc(doc(as(CUST), "orders/o2"), order()));
  });
  it("rejects a tampered price", async () => {
    await assertFails(setDoc(doc(as(CUST), "orders/o2"), order({ items: [{ ...ITEMS[0], price: 3800 }, ITEMS[1]], total: 3980 })));
  });
  it("rejects a wrong total", async () => {
    await assertFails(setDoc(doc(as(CUST), "orders/o2"), order({ total: 999 })));
  });
  it("rejects an item not on the menu", async () => {
    await assertFails(setDoc(doc(as(CUST), "orders/o2"), order({ items: [{ id: "naan", name: "Naan", price: 40 }], itemIds: ["naan"], total: 40 })));
  });
  it("rejects duplicate lines", async () => {
    await assertFails(setDoc(doc(as(CUST), "orders/o2"), order({ items: [ITEMS[0], ITEMS[0]], itemIds: ["biryani", "biryani"], total: 760 })));
  });
  it("rejects an order placed for someone else", async () => {
    await assertFails(setDoc(doc(as(MALLORY), "orders/o2"), order()));
  });
  it("only the restaurant dispatches, with a 4-digit code", async () => {
    await env.clearFirestore();
    await seedBase(env, { orderStatus: "placed" });
    const upd = { status: "dispatched", sealCode: SEAL, dispatchedAt: serverTimestamp() };
    await assertFails(updateDoc(doc(as(CUST), "orders/o1"), upd));
    await assertFails(updateDoc(doc(as(REST), "orders/o1"), { ...upd, sealCode: "47A1" }));
    await assertFails(updateDoc(doc(as(REST), "orders/o1"), { ...upd, total: 1 }));
    await assertSucceeds(updateDoc(doc(as(REST), "orders/o1"), upd));
  });
  it("parties can read the order; others cannot", async () => {
    await assertSucceeds(getDoc(doc(as(CUST), "orders/o1")));
    await assertSucceeds(getDoc(doc(as(REST), "orders/o1")));
    await assertFails(getDoc(doc(as(REST2), "orders/o1")));
    await assertFails(getDoc(doc(as(MALLORY), "orders/o1")));
  });
  it("restaurant lists only its own orders", async () => {
    await assertSucceeds(getDocs(query(collection(as(REST), "orders"), where("restaurantId", "==", REST))));
    await assertFails(getDocs(collection(as(REST), "orders")));
  });
});

describe("dispatch evidence (Flow A)", () => {
  const evidence = (over: Record<string, unknown> = {}) => ({
    check: dispatchCheck,
    inferenceSource: "ON_DEVICE",
    imageSha256: SHA,
    thumbRef: null,
    capturedAt: Date.now(),
    recordedAt: serverTimestamp(),
    ...over,
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await seedBase(env, { orderStatus: "placed" });
  });
  const dispatchBatch = (uid: string, ev: Record<string, unknown>) => {
    const db = as(uid);
    const b = writeBatch(db);
    b.update(doc(db, "orders/o1"), { status: "dispatched", sealCode: SEAL, dispatchedAt: serverTimestamp() });
    b.set(doc(db, "dispatch/o1"), ev);
    return b.commit();
  };
  it("restaurant records evidence with the dispatch", async () => {
    await assertSucceeds(dispatchBatch(REST, evidence()));
  });
  it("rejects a broken seal (default 4)", async () => {
    await assertFails(dispatchBatch(REST, evidence({ check: { ...dispatchCheck, seal_intact: false } })));
  });
  it("rejects a wrong or unreadable code (default 4)", async () => {
    await assertFails(dispatchBatch(REST, evidence({ check: { ...dispatchCheck, seal_code_read: "4712" } })));
    await assertFails(dispatchBatch(REST, evidence({ check: { ...dispatchCheck, seal_code_read: "" } })));
  });
  it("rejects malformed model output", async () => {
    await assertFails(dispatchBatch(REST, evidence({ check: { ...dispatchCheck, confidence: "certain" } })));
    await assertFails(dispatchBatch(REST, evidence({ check: { ...dispatchCheck, extra: 1 } })));
  });
  it("rejects item guesses: a sealed bag hides the food, so the check is seal-only", async () => {
    await assertFails(dispatchBatch(REST, evidence({ check: { ...dispatchCheck, visible_item_count: 2, visible_items: ["Chicken Biryani"] } })));
    const noDamageField = Object.fromEntries(Object.entries(dispatchCheck).filter(([k]) => k !== "spill_or_damage_visible"));
    await assertFails(dispatchBatch(REST, evidence({ check: noDamageField })));
  });
  it("other restaurants and customers cannot write it", async () => {
    await assertFails(dispatchBatch(REST2, evidence()));
    await assertFails(dispatchBatch(CUST, evidence()));
  });
  it("evidence is immutable", async () => {
    await dispatchBatch(REST, evidence());
    await assertFails(updateDoc(doc(as(REST), "dispatch/o1"), { "check.seal_intact": false }));
    await assertFails(deleteDoc(doc(as(REST), "dispatch/o1")));
  });
});

describe("handoff snap (Flow B)", () => {
  const snap = { check: { seal_state: "intact", seal_code_read: SEAL, confidence: "high" }, inferenceSource: "IN_CLOUD", capturedAt: 1, recordedAt: serverTimestamp() };
  it("customer records the sealed bag", async () => {
    await assertSucceeds(setDoc(doc(as(CUST), "handoff/o1"), snap));
  });
  it("others cannot record it", async () => {
    await assertFails(setDoc(doc(as(MALLORY), "handoff/o1"), snap));
    await assertFails(setDoc(doc(as(REST), "handoff/o1"), snap));
  });
  it("cannot be taken after a claim exists", async () => {
    const issuedAt = await createChallenge(as(CUST), "c1");
    await claimBatch(as(CUST), "c1", issuedAt);
    await assertFails(setDoc(doc(as(CUST), "handoff/o1"), snap));
  });
  it("is immutable", async () => {
    await setDoc(doc(as(CUST), "handoff/o1"), snap);
    await assertFails(updateDoc(doc(as(CUST), "handoff/o1"), { "check.seal_state": "broken" }));
    await assertFails(deleteDoc(doc(as(CUST), "handoff/o1")));
  });
});

describe("challenges (server clock)", () => {
  it("issuedAt must be the server time", async () => {
    await assertFails(
      setDoc(doc(as(CUST), "challenges/c1"), { customerId: CUST, orderId: "o1", restaurantId: REST, kind: "fingers", fingers: 2, issuedAt: ago(0) }),
    );
  });
  it("fingers must be 1–3 and the order the customer's own", async () => {
    await assertFails(
      setDoc(doc(as(CUST), "challenges/c1"), { customerId: CUST, orderId: "o1", restaurantId: REST, kind: "fingers", fingers: 4, issuedAt: serverTimestamp() }),
    );
    await assertFails(
      setDoc(doc(as(MALLORY), "challenges/c1"), { customerId: MALLORY, orderId: "o1", restaurantId: REST, kind: "fingers", fingers: 2, issuedAt: serverTimestamp() }),
    );
  });
  it("cannot be created before dispatch", async () => {
    await env.clearFirestore();
    await seedBase(env, { orderStatus: "placed" });
    await assertFails(createChallenge(as(CUST), "c1"));
  });
});

describe("claims (§22.1 throttle, §22.6 checklist)", () => {
  it("a valid claim batch succeeds", async () => {
    const issuedAt = await createChallenge(as(CUST), "c1");
    await assertSucceeds(claimBatch(as(CUST), "c1", issuedAt));
  });
  it("§22.6: second claim within 30 s is rejected", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(fs(ctx), `rateLimits/${CUST}`), { lastClaimAt: ago(10_000), countToday: 1 });
    });
    const issuedAt = await createChallenge(as(CUST), "c1");
    await assertFails(claimBatch(as(CUST), "c1", issuedAt, { countToday: 2 }));
  });
  it("after 30 s the next claim counts up", async () => {
    const last = Date.now() - 60_000;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(fs(ctx), `rateLimits/${CUST}`), { lastClaimAt: ago(60_000), countToday: 2 });
    });
    const issuedAt = await createChallenge(as(CUST), "c1");
    await assertSucceeds(claimBatch(as(CUST), "c1", issuedAt, { countToday: sameUtcDay(last, Date.now()) ? 3 : 1 }));
  });
  it("§22.6: sixth claim in a day is rejected", async () => {
    const last = Date.now() - 60_000;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(fs(ctx), `rateLimits/${CUST}`), { lastClaimAt: ago(60_000), countToday: 5 });
    });
    const issuedAt = await createChallenge(as(CUST), "c1");
    // Near UTC midnight the counter legitimately resets, so this case can't be asserted then.
    if (!sameUtcDay(last, Date.now())) return;
    await assertFails(claimBatch(as(CUST), "c1", issuedAt, { countToday: 6 }));
  });
  it("cannot skip the rate-limit counter", async () => {
    const issuedAt = await createChallenge(as(CUST), "c1");
    const db = as(CUST);
    const b = writeBatch(db);
    b.set(doc(db, "claims/c1"), claimDoc("c1", issuedAt));
    b.set(doc(db, "claimsByOrder/o1"), { claimId: "c1", customerId: CUST });
    await assertFails(b.commit());
  });
  it("§22.6: second claim on the same order is rejected", async () => {
    const t1 = await createChallenge(as(CUST), "c1");
    await claimBatch(as(CUST), "c1", t1);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(fs(ctx), `rateLimits/${CUST}`), { lastClaimAt: ago(120_000), countToday: 1 });
    });
    const t2 = await createChallenge(as(CUST), "c2");
    await assertFails(claimBatch(as(CUST), "c2", t2, { countToday: 2 }));
  });
  it("§22.6: claim more than 120 s after the challenge is rejected", async () => {
    const issuedAt = Date.now() - 180_000;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(fs(ctx), "challenges/c1"), {
        customerId: CUST,
        orderId: "o1",
        restaurantId: REST,
        kind: "fingers",
        fingers: 2,
        issuedAt: ago(180_000),
      });
    });
    await assertFails(claimBatch(as(CUST), "c1", issuedAt));
  });
  it("challenge fields must match the server challenge", async () => {
    const issuedAt = await createChallenge(as(CUST), "c1");
    await assertFails(claimBatch(as(CUST), "c1", issuedAt - 5000));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(fs(ctx), `rateLimits/${CUST}`));
    });
    const c = claimDoc("c1", issuedAt);
    await assertFails(claimBatch(as(CUST), "c1", issuedAt, { claim: { challenge: { ...c.challenge, fingers: 3 } } }));
    await assertFails(claimBatch(as(CUST), "c1", issuedAt, { claim: { challenge: { ...c.challenge, code: "1111" } } }));
  });
  it("rejects malformed evidence", async () => {
    const issuedAt = await createChallenge(as(CUST), "c1");
    const db = as(CUST);
    await assertFails(claimBatch(db, "c1", issuedAt, { claim: { moireScore: 2 } }));
    await assertFails(claimBatch(db, "c1", issuedAt, { claim: { selectedItemIds: ["naan"] } }));
    await assertFails(claimBatch(db, "c1", issuedAt, { claim: { cropRef: "claims/other/crop.jpg" } }));
    await assertFails(claimBatch(db, "c1", issuedAt, { claim: { damageCheck: null, cropSha256: null, cropRef: null } }));
    await assertFails(claimBatch(db, "c1", issuedAt, { claim: { refundAmount: 9999 } }));
  });
  it("a missing-item claim needs no crop", async () => {
    const issuedAt = await createChallenge(as(CUST), "c1");
    await assertSucceeds(
      claimBatch(as(CUST), "c1", issuedAt, {
        claim: { issueType: "missing", damageCheck: null, cropSha256: null, cropRef: null, inferenceSources: { challenge: "IN_CLOUD", damage: null } },
      }),
    );
  });
  it("§22.6: evidence cannot be updated; only its owner can delete it", async () => {
    const issuedAt = await createChallenge(as(CUST), "c1");
    await claimBatch(as(CUST), "c1", issuedAt);
    await assertFails(updateDoc(doc(as(CUST), "claims/c1"), { moireScore: 0 }));
    await assertFails(deleteDoc(doc(as(MALLORY), "claims/c1")));
    await assertFails(deleteDoc(doc(as(REST), "claims/c1")));
    await assertSucceeds(deleteDoc(doc(as(CUST), "claims/c1")));
    // The one-per-order marker survives "Delete my data".
    await assertFails(deleteDoc(doc(as(CUST), "claimsByOrder/o1")));
  });
  it("only the customer and the order's restaurant can read a claim", async () => {
    const issuedAt = await createChallenge(as(CUST), "c1");
    await claimBatch(as(CUST), "c1", issuedAt);
    await assertSucceeds(getDoc(doc(as(CUST), "claims/c1")));
    await assertSucceeds(getDoc(doc(as(REST), "claims/c1")));
    await assertFails(getDoc(doc(as(REST2), "claims/c1")));
    await assertFails(getDoc(doc(as(MALLORY), "claims/c1")));
  });
});

describe("decisions (§22.2 bounds)", () => {
  beforeEach(async () => {
    await seedClaim(env, "c1");
  });
  it("a bounded auto refund is accepted", async () => {
    await assertSucceeds(setDoc(doc(as(CUST), "decisions/c1"), decisionDoc("c1")));
  });
  it("§22.6: auto refund above the cap is rejected", async () => {
    await assertFails(setDoc(doc(as(CUST), "decisions/c1"), decisionDoc("c1", { refundAmount: 501, assessedAmount: 501, liability: { restaurant: 0, transit: 501, platform: 0 } })));
  });
  it("refund above the order total is rejected", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(fs(ctx), "config/policy"), { policyVersion: "v1", autoApproveCap: 5000, holdHours: 48 });
    });
    await assertFails(setDoc(doc(as(CUST), "decisions/c1"), decisionDoc("c1", { refundAmount: 561, assessedAmount: 561, liability: { restaurant: 0, transit: 561, platform: 0 } })));
  });
  it("liability must add up to the refund", async () => {
    await assertFails(setDoc(doc(as(CUST), "decisions/c1"), decisionDoc("c1", { liability: { restaurant: 0, transit: 100, platform: 0 } })));
  });
  it("auto refund needs the claim photo's seal code to match the order", async () => {
    await env.clearFirestore();
    await seedBase(env);
    await seedClaim(env, "c1", { challengeCheck: { seal_code_read: "1234", fingers_visible: 2, seal_state: "broken", photo_of_screen_suspected: false, confidence: "high" } });
    await assertFails(setDoc(doc(as(CUST), "decisions/c1"), decisionDoc("c1")));
  });
  it("review pays nothing", async () => {
    await assertFails(setDoc(doc(as(CUST), "decisions/c1"), decisionDoc("c1", { verdict: "review" })));
    await assertSucceeds(
      setDoc(doc(as(CUST), "decisions/c1"), decisionDoc("c1", { verdict: "review", refundAmount: 0, liability: { restaurant: 0, transit: 0, platform: 0 } })),
    );
  });
  it("policy version must match config/policy", async () => {
    await assertFails(setDoc(doc(as(CUST), "decisions/c1"), decisionDoc("c1", { policyVersion: "v0" })));
  });
  it("only the claim owner writes it, once", async () => {
    await assertFails(setDoc(doc(as(MALLORY), "decisions/c1"), decisionDoc("c1", { customerId: MALLORY })));
    await assertFails(setDoc(doc(as(REST), "decisions/c1"), decisionDoc("c1")));
    await setDoc(doc(as(CUST), "decisions/c1"), decisionDoc("c1"));
    await assertFails(updateDoc(doc(as(CUST), "decisions/c1"), { refundAmount: 0 }));
    await assertFails(deleteDoc(doc(as(CUST), "decisions/c1")));
  });
  it("a hold decision must be written with its hold", async () => {
    await assertFails(setDoc(doc(as(CUST), "decisions/c1"), holdDecision("c1")));
    const db = as(CUST);
    const b = writeBatch(db);
    b.set(doc(db, "decisions/c1"), holdDecision("c1"));
    b.set(doc(db, "holds/c1"), holdDoc("c1"));
    await assertSucceeds(b.commit());
  });
  it("the hold must mirror the decision's split", async () => {
    const db = as(CUST);
    const b = writeBatch(db);
    b.set(doc(db, "decisions/c1"), holdDecision("c1"));
    b.set(doc(db, "holds/c1"), holdDoc("c1", { parties: { restaurant: 108, transit: 0, platform: 0 } }));
    await assertFails(b.commit());
  });
});

describe("holds (48 h, server clock)", () => {
  it("restaurant can accept before the window ends; the customer cannot", async () => {
    await seedHold(env, "c1");
    await assertFails(updateDoc(doc(as(CUST), "holds/c1"), { state: "accepted", resolvedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as(REST), "holds/c1"), { state: "accepted", resolvedAt: serverTimestamp() }));
  });
  it("cannot settle before the window ends", async () => {
    await seedHold(env, "c1");
    await assertFails(updateDoc(doc(as(CUST), "holds/c1"), { state: "settled", resolvedAt: serverTimestamp() }));
  });
  it("either party settles after the window", async () => {
    await seedHold(env, "c1", 49 * 3600_000);
    await assertSucceeds(updateDoc(doc(as(CUST), "holds/c1"), { state: "settled", resolvedAt: serverTimestamp() }));
  });
  it("cannot accept after the window", async () => {
    await seedHold(env, "c1", 49 * 3600_000);
    await assertFails(updateDoc(doc(as(REST), "holds/c1"), { state: "accepted", resolvedAt: serverTimestamp() }));
  });
  it("cannot change the amounts", async () => {
    await seedHold(env, "c1");
    await assertFails(updateDoc(doc(as(REST), "holds/c1"), { state: "accepted", resolvedAt: serverTimestamp(), parties: { restaurant: 0, transit: 108, platform: 0 } }));
  });
});

describe("counter-evidence (Flow E)", () => {
  const counterBatch = (uid: string, outcome: "settled" | "review", over: Record<string, unknown> = {}) => {
    const db = as(uid);
    const b = writeBatch(db);
    b.set(doc(db, "counterEvidence/c1"), {
      claimId: "c1",
      restaurantId: uid,
      check: dispatchCheck,
      inferenceSource: "ON_DEVICE",
      imageSha256: SHA,
      photoRef: "counter/c1/photo.jpg",
      recordedAt: serverTimestamp(),
    });
    b.set(doc(db, "resolutions/c1"), {
      claimId: "c1",
      restaurantId: uid,
      customerId: CUST,
      outcome,
      refundAmount: 108,
      liability: outcome === "settled" ? { restaurant: 0, transit: 108, platform: 0 } : { restaurant: 0, transit: 0, platform: 0 },
      reasons: [outcome === "settled" ? "counter_evidence_clear" : "counter_evidence_unclear"],
      policyVersion: "v1",
      createdAt: serverTimestamp(),
      ...over,
    });
    b.update(doc(db, "holds/c1"), { state: outcome === "settled" ? "resolved" : "escalated", resolvedAt: serverTimestamp() });
    return b.commit();
  };
  it("clear counter-evidence resolves the hold", async () => {
    await seedHold(env, "c1");
    await assertSucceeds(counterBatch(REST, "settled"));
  });
  it("unclear counter-evidence escalates to human review", async () => {
    await seedHold(env, "c1");
    await assertSucceeds(counterBatch(REST, "review"));
  });
  it("cannot change the customer's refund", async () => {
    await seedHold(env, "c1");
    await assertFails(counterBatch(REST, "settled", { refundAmount: 50, liability: { restaurant: 0, transit: 50, platform: 0 } }));
  });
  it("hold state must agree with the outcome", async () => {
    await seedHold(env, "c1");
    const db = as(REST);
    const b = writeBatch(db);
    b.set(doc(db, "counterEvidence/c1"), {
      claimId: "c1", restaurantId: REST, check: dispatchCheck, inferenceSource: "ON_DEVICE", imageSha256: SHA, photoRef: "counter/c1/photo.jpg", recordedAt: serverTimestamp(),
    });
    b.set(doc(db, "resolutions/c1"), {
      claimId: "c1", restaurantId: REST, customerId: CUST, outcome: "review", refundAmount: 108,
      liability: { restaurant: 0, transit: 0, platform: 0 }, reasons: [], policyVersion: "v1", createdAt: serverTimestamp(),
    });
    b.update(doc(db, "holds/c1"), { state: "resolved", resolvedAt: serverTimestamp() });
    await assertFails(b.commit());
  });
  it("only the order's restaurant, only within the window", async () => {
    await seedHold(env, "c1");
    await assertFails(counterBatch(REST2, "settled"));
    await assertFails(counterBatch(CUST, "settled"));
    await env.clearFirestore();
    await seedBase(env);
    await seedHold(env, "c1", 49 * 3600_000);
    await assertFails(counterBatch(REST, "settled"));
  });
});

describe("replay audit (§22.2)", () => {
  const audit = (over: Record<string, unknown> = {}) => ({
    claimId: "c1", restaurantId: REST, match: false, mismatchFields: ["liability"], cropHashMatch: true, policyVersion: "v1", auditedAt: serverTimestamp(), ...over,
  });
  beforeEach(async () => {
    await seedClaim(env, "c1");
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(fs(ctx), "decisions/c1"), { ...decisionDoc("c1"), createdAt: ago(0) });
    });
  });
  it("§22.6: the restaurant records a mismatch once", async () => {
    await assertSucceeds(setDoc(doc(as(REST), "audits/c1"), audit()));
    await assertFails(setDoc(doc(as(REST), "audits/c1"), audit({ match: true, mismatchFields: [] })));
    await assertFails(updateDoc(doc(as(REST), "audits/c1"), { match: true }));
  });
  it("customers and other restaurants cannot write audits", async () => {
    await assertFails(setDoc(doc(as(CUST), "audits/c1"), audit({ restaurantId: CUST })));
    await assertFails(setDoc(doc(as(REST2), "audits/c1"), audit({ restaurantId: REST2 })));
  });
});

describe("restaurant web app reads (Phase 1 query patterns)", () => {
  const audit = { claimId: "c1", restaurantId: REST, match: true, mismatchFields: [], cropHashMatch: null, policyVersion: "v1", auditedAt: serverTimestamp() };
  const byRestaurant = (uid: string, coll: string, restaurantId = uid) => getDocs(query(collection(as(uid), coll), where("restaurantId", "==", restaurantId)));
  beforeEach(async () => {
    await seedHold(env, "c1");
  });
  it("restaurant lists its own decisions, holds, resolutions and audits", async () => {
    await assertSucceeds(setDoc(doc(as(REST), "audits/c1"), audit));
    for (const coll of ["decisions", "holds", "resolutions", "audits"]) {
      await assertSucceeds(byRestaurant(REST, coll));
    }
  });
  it("cannot list another restaurant's records, or list without the restaurantId filter", async () => {
    for (const coll of ["decisions", "holds", "resolutions", "audits"]) {
      await assertFails(byRestaurant(REST2, coll, REST));
      await assertFails(getDocs(collection(as(REST), coll)));
    }
  });
  it("restaurant reads the evidence behind its decision", async () => {
    await assertSucceeds(getDoc(doc(as(REST), "claims/c1")));
    await assertSucceeds(getDoc(doc(as(REST), "decisions/c1")));
    await assertFails(getDoc(doc(as(REST2), "claims/c1")));
  });
  it("reading absent dispatch/handoff evidence succeeds (it just doesn't exist)", async () => {
    await assertSucceeds(getDoc(doc(as(REST), "dispatch/o1")));
    await assertSucceeds(getDoc(doc(as(REST), "handoff/o1")));
  });
  it("a deleted claim reads as permission-denied, not as missing (the web audit relies on this)", async () => {
    await assertSucceeds(deleteDoc(doc(as(CUST), "claims/c1")));
    await assertFails(getDoc(doc(as(REST), "claims/c1")));
  });
  it("first run: an unknown restaurant and a free pair code can be looked up", async () => {
    await assertSucceeds(getDoc(doc(as("newbie"), "restaurants/newbie")));
    await assertSucceeds(getDoc(doc(as("newbie"), "pairCodes/QQQQQQ")));
    await assertSucceeds(getDoc(doc(as("newbie"), "users/newbie")));
  });
  it("re-accepting a newer Terms version updates the user doc", async () => {
    await assertSucceeds(setDoc(doc(as(REST), "users/" + REST), { termsVersion: "2026-11-01", acceptedAt: serverTimestamp(), role: "restaurant" }));
    await assertSucceeds(setDoc(doc(as(REST), "users/" + REST), { termsVersion: "2026-11-22", acceptedAt: serverTimestamp(), role: "restaurant" }));
  });
  it("restaurant reads its counter-evidence after answering", async () => {
    const db = as(REST);
    const b = writeBatch(db);
    b.set(doc(db, "counterEvidence/c1"), {
      claimId: "c1", restaurantId: REST, check: dispatchCheck, inferenceSource: "IN_CLOUD", imageSha256: SHA, photoRef: "counter/c1/photo.jpg", recordedAt: serverTimestamp(),
    });
    b.set(doc(db, "resolutions/c1"), {
      claimId: "c1", restaurantId: REST, customerId: CUST, outcome: "settled", refundAmount: 108,
      liability: { restaurant: 0, transit: 108, platform: 0 }, reasons: ["counter_evidence_clear"], policyVersion: "v1", createdAt: serverTimestamp(),
    });
    b.update(doc(db, "holds/c1"), { state: "resolved", resolvedAt: serverTimestamp() });
    await assertSucceeds(b.commit());
    await assertSucceeds(getDoc(doc(as(REST), "counterEvidence/c1")));
    await assertSucceeds(getDoc(doc(as(CUST), "counterEvidence/c1")));
    await assertFails(getDoc(doc(as(REST2), "counterEvidence/c1")));
  });
});

describe("config", () => {
  it("is readable but never writable from clients", async () => {
    await assertSucceeds(getDoc(doc(as(CUST), "config/policy")));
    await assertFails(setDoc(doc(as(REST), "config/policy"), { policyVersion: "v1", autoApproveCap: 99999, holdHours: 1 }));
  });
});

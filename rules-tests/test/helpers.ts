// Shared fixtures for the Firestore/Storage emulator rules tests.
import { initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, writeBatch, type Firestore } from "firebase/firestore";
import { deleteObject, listAll, ref, type FirebaseStorage, type StorageReference } from "firebase/storage";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");

export const PROJECT = "demo-fairclaim";
export const REST = "rest1";
export const REST2 = "rest2";
export const CUST = "cust1";
export const MALLORY = "mallory";
export const SEAL = "4721";
export const PAIR = "ABC234";

export const MENU = {
  biryani: { name: "Chicken Biryani", price: 380 },
  "gulab-jamun": { name: "Gulab Jamun", price: 180 },
  raita: { name: "Raita", price: 80 },
};
export const ITEMS = [
  { id: "biryani", name: "Chicken Biryani", price: 380 },
  { id: "gulab-jamun", name: "Gulab Jamun", price: 180 },
];

export async function setup(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(join(root, "firestore.rules"), "utf8") },
    storage: { rules: readFileSync(join(root, "storage.rules"), "utf8") },
  });
}

// The test SDK hands back compat-typed instances; the modular API accepts them.
export const fs = (ctx: RulesTestContext): Firestore => ctx.firestore() as unknown as Firestore;
export const st = (ctx: RulesTestContext): FirebaseStorage => ctx.storage() as unknown as FirebaseStorage;

/**
 * env.clearStorage() only deletes objects at the bucket root (it calls listAll()
 * once, without recursing), and every FairClaim path is nested — so leftovers
 * would trip the create-once rules in later tests.
 */
export async function clearStorageDeep(env: RulesTestEnvironment) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const wipe = async (dir: StorageReference): Promise<void> => {
      const { items, prefixes } = await listAll(dir);
      await Promise.all([...items.map((i) => deleteObject(i)), ...prefixes.map(wipe)]);
    };
    await wipe(ref(st(ctx)));
  });
}

export const ago = (ms: number) => Timestamp.fromMillis(Date.now() - ms);

/** Policy mirror, two restaurants, and order o1 dispatched with seal 4721. */
export async function seedBase(env: RulesTestEnvironment, opts: { orderStatus?: string } = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = fs(ctx);
    await setDoc(doc(db, "config/policy"), { policyVersion: "v1", autoApproveCap: 500, holdHours: 48 });
    for (const [id, code] of [[REST, PAIR], [REST2, "XYZ789"]] as const) {
      await setDoc(doc(db, `restaurants/${id}`), { name: `Kitchen ${id}`, pairCode: code, menu: MENU, createdAt: Timestamp.now() });
      await setDoc(doc(db, `pairCodes/${code}`), { restaurantId: id });
    }
    await setDoc(doc(db, "orders/o1"), {
      restaurantId: REST,
      customerId: CUST,
      items: ITEMS,
      itemIds: ITEMS.map((i) => i.id),
      total: 560,
      status: opts.orderStatus ?? "dispatched",
      sealCode: opts.orderStatus === "placed" ? null : SEAL,
      createdAt: Timestamp.now(),
      ...(opts.orderStatus === "placed" ? {} : { dispatchedAt: Timestamp.now() }),
    });
  });
}

export const challengeCheck = { seal_code_read: SEAL, fingers_visible: 2, seal_state: "broken", photo_of_screen_suspected: false, confidence: "high" };
export const damageCheck = { matched_item: "Gulab Jamun", issue: "spilled", severity: "partial", confidence: "medium" };
export const dispatchCheck = {
  seal_intact: true,
  seal_code_read: SEAL,
  visible_item_count: 2,
  visible_items: ["Chicken Biryani", "Gulab Jamun"],
  spill_or_damage_visible: false,
  confidence: "high",
};
export const SHA = "a".repeat(64);

/** Customer creates the server-clock challenge; returns its issuedAt in ms. */
export async function createChallenge(db: Firestore, claimId: string, orderId = "o1"): Promise<number> {
  await setDoc(doc(db, `challenges/${claimId}`), {
    customerId: CUST,
    orderId,
    restaurantId: REST,
    kind: "fingers",
    fingers: 2,
    issuedAt: serverTimestamp(),
  });
  const snap = await getDoc(doc(db, `challenges/${claimId}`));
  // Timestamp.toMillis() can be fractional (it adds nanos/1e6); rules compare whole milliseconds.
  return Math.floor((snap.data()?.issuedAt as Timestamp).toMillis());
}

export function claimDoc(claimId: string, issuedAt: number, over: Record<string, unknown> = {}) {
  return {
    claimId,
    orderId: "o1",
    customerId: CUST,
    issueType: "damaged",
    selectedItemIds: ["gulab-jamun"],
    challenge: { kind: "fingers", code: SEAL, fingers: 2, issuedAt, capturedAt: issuedAt + 15_000, expiresAt: issuedAt + 60_000 },
    challengeCheck,
    damageCheck,
    moireScore: 0.1,
    cropSha256: SHA,
    cropRef: `claims/${claimId}/crop.jpg`,
    inferenceSources: { challenge: "ON_DEVICE", damage: "ON_DEVICE" },
    customerClaims30d: 0,
    createdAt: serverTimestamp(),
    ...over,
  };
}

/** The atomic claim write the Android app performs: claim + rate limit + one-per-order marker. */
export function claimBatch(
  db: Firestore,
  claimId: string,
  issuedAt: number,
  opts: { countToday?: number; claim?: Record<string, unknown>; orderId?: string } = {},
) {
  const orderId = opts.orderId ?? "o1";
  const b = writeBatch(db);
  b.set(doc(db, `claims/${claimId}`), claimDoc(claimId, issuedAt, { orderId, ...opts.claim }));
  b.set(doc(db, `rateLimits/${CUST}`), { lastClaimAt: serverTimestamp(), countToday: opts.countToday ?? 1 });
  b.set(doc(db, `claimsByOrder/${orderId}`), { claimId, customerId: CUST });
  return b.commit();
}

/** Seeds a stored claim directly (rules off), for decision/hold tests. */
export async function seedClaim(env: RulesTestEnvironment, claimId: string, over: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = fs(ctx);
    const now = Date.now();
    await setDoc(doc(db, `challenges/${claimId}`), { customerId: CUST, orderId: "o1", restaurantId: REST, kind: "fingers", fingers: 2, issuedAt: Timestamp.fromMillis(now) });
    await setDoc(doc(db, `claims/${claimId}`), { ...claimDoc(claimId, now), createdAt: Timestamp.fromMillis(now), ...over });
  });
}

export function decisionDoc(claimId: string, over: Record<string, unknown> = {}) {
  return {
    claimId,
    orderId: "o1",
    customerId: CUST,
    restaurantId: REST,
    verdict: "auto_refund",
    refundAmount: 108,
    assessedAmount: 108,
    currency: "INR",
    liability: { restaurant: 0, transit: 108, platform: 0 },
    liabilityCase: "handling_damage",
    split: null,
    reasons: ["dispatch_valid", "handoff_intact"],
    holdHours: null,
    review: { status: "ok", consistent: true, flags: [] },
    explanations: { customer_en: "Spilled in transit.", customer_hi: "", customer_ta: "", restaurant: "Not charged." },
    engine: "kotlin",
    policyVersion: "v1",
    createdAt: serverTimestamp(),
    ...over,
  };
}

export const holdDecision = (claimId: string) =>
  decisionDoc(claimId, {
    verdict: "hold",
    liability: { restaurant: 41, transit: 67, platform: 0 },
    liabilityCase: "hold_damage_dispatch_uncertain",
    split: { restaurantPermille: 380, transitPermille: 620 },
    holdHours: 48,
  });

export const holdDoc = (claimId: string, over: Record<string, unknown> = {}) => ({
  claimId,
  customerId: CUST,
  restaurantId: REST,
  amount: 108,
  parties: { restaurant: 41, transit: 67, platform: 0 },
  state: "held",
  holdHours: 48,
  createdAt: serverTimestamp(),
  ...over,
});

/** Seeds a decided hold (rules off); `ageMs` back-dates the hold start. */
export async function seedHold(env: RulesTestEnvironment, claimId: string, ageMs = 0) {
  await seedClaim(env, claimId);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = fs(ctx);
    await setDoc(doc(db, `decisions/${claimId}`), { ...holdDecision(claimId), createdAt: ago(ageMs) });
    await setDoc(doc(db, `holds/${claimId}`), { ...holdDoc(claimId), createdAt: ago(ageMs) });
  });
}

/** A 1 KB (or `bytes`) JPEG-labelled payload. */
export const jpeg = (bytes = 1024) => new Uint8Array(bytes).fill(0xff);
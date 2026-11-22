// DEV ONLY — never imported by apps/*. Plays the customer (Android) side against the
// local emulators so the restaurant web flows can be exercised before the Android app
// exists. Every write goes through the real security rules.
//
//   npm run emulators                                             # terminal 1
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-policy.mjs demo-fairclaim
//   npm run dev:web   (apps/restaurant-web/.env.local: VITE_USE_EMULATORS=true)
//   npm run dev:customer -- order ABC234                          # pair code from the web header
//   npm run dev:customer -- claim <orderId> damaged|nohandoff|missing|unverified|tampered
//
// PowerShell: $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; node scripts/seed-policy.mjs demo-fairclaim
import { decide } from "@fairclaim/engine";
import { defaultPolicy, type ChallengeCheck, type DamageCheck, type EngineDecision, type IssueType } from "@fairclaim/schemas";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { connectStorageEmulator, getStorage, ref, uploadBytes } from "firebase/storage";
import { createHash, randomBytes } from "node:crypto";

const PROJECT = "demo-fairclaim"; // must match apps/restaurant-web/src/firebase/app.ts EMULATOR_PROJECT
const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT, appId: "1:000000000000:web:demo", storageBucket: `${PROJECT}.appspot.com` }, "customer-sim");
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "127.0.0.1", 8080);
connectStorageEmulator(storage, "127.0.0.1", 9199);

const EMAIL = "test-customer@fairclaim.test";
const PASSWORD = "not-a-secret-emulator-only";

async function signIn(): Promise<string> {
  try {
    return (await signInWithEmailAndPassword(auth, EMAIL, PASSWORD)).user.uid;
  } catch {
    return (await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD)).user.uid;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exactMs = (t: Timestamp) => t.seconds * 1000 + Math.floor(t.nanoseconds / 1_000_000);

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function placeOrder(pairCode: string, itemIds: string[]) {
  const uid = await signIn();
  const pair = await getDoc(doc(db, "pairCodes", pairCode.toUpperCase()));
  if (!pair.exists()) fail(`No restaurant with pair code ${pairCode}. Click "Connect a phone" in the web app and use the code under the QR.`);
  const restaurantId = String(pair.data().restaurantId);
  const rest = await getDoc(doc(db, "restaurants", restaurantId));
  const menu = (rest.data()?.menu ?? {}) as Record<string, { name: string; price: number }>;
  const ids = itemIds.length > 0 ? itemIds : ["biryani", "gulab-jamun"].filter((id) => id in menu);
  const items = ids.map((id) => {
    const m = menu[id];
    if (!m) fail(`"${id}" is not on the menu. Menu ids: ${Object.keys(menu).join(", ")}`);
    return { id, name: m.name, price: m.price };
  });
  await setDoc(doc(db, "users", uid), { termsVersion: "2026-11-22", acceptedAt: serverTimestamp(), role: "customer" });
  const orderId = `o-${randomBytes(6).toString("hex")}`;
  await setDoc(doc(db, "orders", orderId), {
    restaurantId,
    customerId: uid,
    items,
    itemIds: items.map((i) => i.id),
    total: items.reduce((s, i) => s + i.price, 0),
    status: "placed",
    sealCode: null,
    createdAt: serverTimestamp(),
  });
  console.log(`✓ Order ${orderId} placed (${items.map((i) => i.name).join(", ")}). Dispatch it in the web app, then:`);
  console.log(`  npm run dev:customer -- claim ${orderId} damaged`);
}

type Scenario = "damaged" | "nohandoff" | "missing" | "unverified" | "tampered";
const SCENARIOS: Scenario[] = ["damaged", "nohandoff", "missing", "unverified", "tampered"];

async function claim(orderId: string, scenario: Scenario) {
  const uid = await signIn();
  const policySnap = await getDoc(doc(db, "config", "policy"));
  if (!policySnap.exists()) fail("config/policy missing: run scripts/seed-policy.mjs against the emulator first (see the header of this file).");
  const policy = defaultPolicy;
  if (policySnap.data().policyVersion !== policy.policyVersion) fail("config/policy version differs from the bundled policy.");

  const orderSnap = await getDoc(doc(db, "orders", orderId));
  if (!orderSnap.exists()) fail(`Order ${orderId} not found (or not yours).`);
  const o = orderSnap.data() as { restaurantId: string; items: { id: string; name: string; price: number }[]; total: number; status: string; sealCode: string | null };
  if (o.status === "placed" || o.sealCode === null) fail("Dispatch the order in the web app first.");
  const seal = o.sealCode;
  const item = o.items[0] ?? fail("order has no items");
  const issueType: IssueType = scenario === "missing" ? "missing" : "damaged";

  // Flow B: handoff snap before opening (skipped for "nohandoff").
  if (scenario !== "nohandoff" && !(await getDoc(doc(db, "handoff", orderId))).exists()) {
    await setDoc(doc(db, "handoff", orderId), {
      check: { seal_state: "intact", seal_code_read: seal, confidence: "high" },
      inferenceSource: "ON_DEVICE",
      capturedAt: Date.now(),
      recordedAt: serverTimestamp(),
    });
  }
  if (o.status === "dispatched") await updateDoc(doc(db, "orders", orderId), { status: "delivered", deliveredAt: serverTimestamp() });

  // Throttle: one claim per 30 s (rules use server time; leave a margin). Wait *before*
  // the challenge: the claim must land within 120 s of it.
  const rl = await getDoc(doc(db, "rateLimits", uid));
  let countToday = 1;
  if (rl.exists()) {
    const last = exactMs(rl.data().lastClaimAt as Timestamp);
    const wait = last + 32_000 - Date.now();
    if (wait > 0) {
      console.log(`… waiting ${Math.ceil(wait / 1000)} s (one claim per 30 s)`);
      await sleep(wait);
    }
    const sameDay = new Date(last).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
    countToday = sameDay ? Number(rl.data().countToday) + 1 : 1;
    if (countToday > 5) fail("5 claims today already (rules limit). Restart the emulators to reset.");
  }

  // Server-clock challenge (§22.2).
  const claimId = `c-${randomBytes(6).toString("hex")}`;
  const fingers = 2;
  await setDoc(doc(db, "challenges", claimId), { customerId: uid, orderId, restaurantId: o.restaurantId, kind: "fingers", fingers, issuedAt: serverTimestamp() });
  const issuedAt = exactMs((await getDoc(doc(db, "challenges", claimId))).data()?.issuedAt as Timestamp);

  // Crop: a small stand-in JPEG payload; its SHA-256 is what the audit re-checks.
  let cropRef: string | null = null;
  let cropSha256: string | null = null;
  if (issueType !== "missing") {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(2048), 0xff, 0xd9]);
    cropRef = `claims/${claimId}/crop.jpg`;
    cropSha256 = createHash("sha256").update(bytes).digest("hex");
    await uploadBytes(ref(storage, cropRef), bytes, { contentType: "image/jpeg" });
  }

  const challengeCheck: ChallengeCheck = {
    seal_code_read: seal,
    fingers_visible: scenario === "unverified" ? fingers + 1 : fingers,
    seal_state: "broken",
    photo_of_screen_suspected: false,
    confidence: "high",
  };
  const damageCheck: DamageCheck | null = issueType === "missing" ? null : { matched_item: item.name, issue: "spilled", severity: "partial", confidence: "high" };
  const challenge = { kind: "fingers" as const, code: seal, fingers, issuedAt, capturedAt: issuedAt + 12_000, expiresAt: issuedAt + policy.challengeWindowSec * 1000 };

  const [dispatchSnap, handoffSnap] = await Promise.all([getDoc(doc(db, "dispatch", orderId)), getDoc(doc(db, "handoff", orderId))]);
  const review = { status: "ok" as const, consistent: true, flags: [] as string[] };
  const decision: EngineDecision = decide({
    order: { id: orderId, items: o.items, total: o.total, sealCode: seal },
    dispatch: dispatchSnap.exists() ? { check: dispatchSnap.data().check } : null,
    handoff: handoffSnap.exists() ? { check: handoffSnap.data().check } : null,
    claim: { issueType, selectedItemIds: [item.id], challenge, challengeCheck, damageCheck, moireScore: 0.08, customerClaims30d: 0 },
    review,
    policy,
  });
  let written = decision;
  if (scenario === "tampered") {
    if (decision.refundAmount === 0) fail(`The engine says ${decision.verdict} with ₹0; nothing to tamper with. Try another order.`);
    // A modified client shifting the whole refund onto the restaurant. Rules can't see
    // who should pay; the restaurant's replay audit must catch it.
    written = { ...decision, liability: { restaurant: decision.refundAmount, transit: 0, platform: 0 } };
  }

  const b = writeBatch(db);
  b.set(doc(db, "claims", claimId), {
    claimId,
    orderId,
    customerId: uid,
    issueType,
    selectedItemIds: [item.id],
    challenge,
    challengeCheck,
    damageCheck,
    moireScore: 0.08,
    cropSha256,
    cropRef,
    inferenceSources: { challenge: "ON_DEVICE", damage: damageCheck ? "ON_DEVICE" : null },
    customerClaims30d: 0,
    createdAt: serverTimestamp(),
  });
  b.set(doc(db, "rateLimits", uid), { lastClaimAt: serverTimestamp(), countToday });
  b.set(doc(db, "claimsByOrder", orderId), { claimId, customerId: uid });
  await b.commit();

  const d = writeBatch(db);
  d.set(doc(db, "decisions", claimId), {
    claimId,
    orderId,
    customerId: uid,
    restaurantId: o.restaurantId,
    ...written,
    review,
    explanations: {
      customer_en: "Simulated by dev/customer-sim.ts.",
      customer_hi: "",
      customer_ta: "",
      restaurant: "Simulated decision written by the dev customer script, not by a model.",
    },
    engine: "ts",
    createdAt: serverTimestamp(),
  });
  if (written.verdict === "hold") {
    d.set(doc(db, "holds", claimId), {
      claimId,
      customerId: uid,
      restaurantId: o.restaurantId,
      amount: written.refundAmount,
      parties: written.liability,
      state: "held",
      holdHours: policy.holdHours,
      createdAt: serverTimestamp(),
    });
  }
  await d.commit();
  console.log(`✓ Claim ${claimId}: ${written.verdict}, refund ₹${written.refundAmount}, case ${written.liabilityCase}${scenario === "tampered" ? " (liability tampered)" : ""}`);
  console.log(`  reasons: ${written.reasons.join(", ")}`);
}

const [cmd, a1, ...rest] = process.argv.slice(2);
try {
  if (cmd === "order" && a1) await placeOrder(a1, rest);
  else if (cmd === "claim" && a1 && SCENARIOS.includes((rest[0] ?? "damaged") as Scenario)) await claim(a1, (rest[0] ?? "damaged") as Scenario);
  else {
    console.log("usage: npm run dev:customer -- order <PAIRCODE> [itemId ...]");
    console.log(`       npm run dev:customer -- claim <orderId> [${SCENARIOS.join("|")}]`);
    process.exitCode = 2;
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
process.exit(process.exitCode ?? 0);

// FAIRCLAIM_DEMO_DATA — dev-only sample claims (VITE_DEMO_DATA=true with `npm run dev:web`).
// Never written to Firebase and never in a production build (scripts/check-dist.mjs
// fails the build check if this marker appears in dist/). Every decision is computed by
// the real engine from realistic evidence, so all numbers on the pages are consistent.
import { decide, resolveCounterEvidence } from "@fairclaim/engine";
import {
  defaultPolicy,
  type ChallengeCheck,
  type DamageCheck,
  type DamageIssue,
  type DispatchCheck,
  type EngineDecision,
  type InferenceSource,
  type IssueType,
  type Severity,
} from "@fairclaim/schemas";
import type { AuditDoc, ClaimDoc, DecisionDoc, DispatchDoc, HandoffDoc, HoldDoc, OrderDoc, ResolutionDoc } from "../data/docs.ts";
import type { CaseDocs } from "../data/engineInput.ts";
import { SEED_MENU } from "../data/menu.ts";

export interface DemoData {
  orders: OrderDoc[];
  decisions: Map<string, DecisionDoc>;
  holds: Map<string, HoldDoc>;
  resolutions: Map<string, ResolutionDoc>;
  audits: Map<string, AuditDoc>;
  claims: Map<string, ClaimDoc>;
  cases: Map<string, CaseDocs>;
}

const H = 3_600_000;
// Anonymous-looking customer uids (pseudonyms only, like real anonymous accounts).
const CUSTOMERS = ["dQ8xZk2LmR7aP3", "vT5nW9cB1yHs4K", "pL0eJ6uF8iGt2M", "aZ3rX7qN5wCv9D", "kM1sY4hU6oBe8J", "gH2fV0tR3pQx5N"];

interface Scenario {
  id: string;
  customer: number;
  hoursAgo: number;
  items: (keyof typeof SEED_MENU)[];
  issue: IssueType;
  /** Menu id of the item the customer selected. */
  selected: keyof typeof SEED_MENU;
  damage?: { issue: DamageIssue; severity: Severity };
  dispatch: null | { confidence: "high" | "medium" | "low"; damageVisible?: boolean };
  handoff: null | "intact" | "broken";
  fraud?: { wrongCode?: boolean; moire?: number; screen?: boolean; wrongFingers?: boolean; late?: boolean };
  sources?: [InferenceSource, InferenceSource | null];
  claims30d?: number;
  hold?: HoldDoc["state"];
  counter?: "clear" | "unclear";
  /** A modified client shifted the refund onto the restaurant; the replay audit must catch it. */
  tampered?: boolean;
  /** Too recent to have been audited yet. */
  unaudited?: boolean;
}

const HANDMADE: Scenario[] = [
  { id: "spill-1", customer: 0, hoursAgo: 0.4, items: ["biryani", "gulab-jamun"], issue: "damaged", selected: "gulab-jamun", damage: { issue: "spilled", severity: "partial" }, dispatch: { confidence: "high" }, handoff: "intact", unaudited: true },
  { id: "crush-1", customer: 1, hoursAgo: 2.5, items: ["masala-dosa", "mango-lassi"], issue: "damaged", selected: "mango-lassi", damage: { issue: "spilled", severity: "total" }, dispatch: { confidence: "high" }, handoff: "intact" },
  { id: "notpacked-1", customer: 2, hoursAgo: 5, items: ["paneer-tikka", "butter-naan", "raita"], issue: "missing", selected: "raita", dispatch: { confidence: "high" }, handoff: "intact", sources: ["ON_DEVICE", null] },
  { id: "tamper-1", customer: 3, hoursAgo: 7, items: ["biryani", "raita"], issue: "missing", selected: "biryani", dispatch: { confidence: "high" }, handoff: "broken", sources: ["IN_CLOUD", null] },
  { id: "hold-open-1", customer: 4, hoursAgo: 3, items: ["dal-makhani", "butter-naan"], issue: "damaged", selected: "dal-makhani", damage: { issue: "spilled", severity: "partial" }, dispatch: { confidence: "high" }, handoff: null, hold: "held" },
  { id: "hold-open-2", customer: 5, hoursAgo: 44.5, items: ["paneer-tikka", "gulab-jamun"], issue: "damaged", selected: "paneer-tikka", damage: { issue: "crushed", severity: "minor" }, dispatch: { confidence: "medium" }, handoff: "intact", hold: "held", sources: ["IN_CLOUD", "IN_CLOUD"] },
  { id: "hold-accepted", customer: 0, hoursAgo: 26, items: ["biryani", "mango-lassi"], issue: "damaged", selected: "biryani", damage: { issue: "spilled", severity: "minor" }, dispatch: null, handoff: "intact", hold: "accepted" },
  { id: "hold-settled", customer: 1, hoursAgo: 60, items: ["masala-dosa"], issue: "damaged", selected: "masala-dosa", damage: { issue: "crushed", severity: "partial" }, dispatch: { confidence: "high" }, handoff: null, hold: "settled" },
  { id: "hold-resolved", customer: 2, hoursAgo: 30, items: ["dal-makhani", "raita"], issue: "damaged", selected: "dal-makhani", damage: { issue: "spilled", severity: "partial" }, dispatch: null, handoff: "intact", hold: "resolved", counter: "clear" },
  { id: "hold-open-3", customer: 3, hoursAgo: 12, items: ["biryani", "raita", "butter-naan"], issue: "missing", selected: "raita", dispatch: null, handoff: "intact", hold: "held", sources: ["ON_DEVICE", null] },
  { id: "hold-escalated", customer: 3, hoursAgo: 34, items: ["biryani", "gulab-jamun"], issue: "damaged", selected: "gulab-jamun", damage: { issue: "spilled", severity: "total" }, dispatch: { confidence: "medium" }, handoff: "intact", hold: "escalated", counter: "unclear" },
  { id: "fake-screen", customer: 4, hoursAgo: 9, items: ["biryani"], issue: "damaged", selected: "biryani", damage: { issue: "crushed", severity: "total" }, dispatch: { confidence: "high" }, handoff: "intact", fraud: { wrongCode: true, moire: 0.61, screen: true } },
  { id: "fake-oldphoto", customer: 5, hoursAgo: 15, items: ["paneer-tikka", "butter-naan"], issue: "damaged", selected: "paneer-tikka", damage: { issue: "spilled", severity: "total" }, dispatch: { confidence: "high" }, handoff: "intact", fraud: { wrongFingers: true, late: true }, sources: ["IN_CLOUD", "IN_CLOUD"] },
  { id: "fake-code", customer: 4, hoursAgo: 22, items: ["dal-makhani", "mango-lassi"], issue: "damaged", selected: "dal-makhani", damage: { issue: "spilled", severity: "total" }, dispatch: { confidence: "high" }, handoff: "intact", fraud: { wrongCode: true } },
  { id: "repeat-claimer", customer: 1, hoursAgo: 11, items: ["biryani", "paneer-tikka", "dal-makhani"], issue: "damaged", selected: "biryani", damage: { issue: "spilled", severity: "total" }, dispatch: { confidence: "high" }, handoff: "intact", claims30d: 3 },
  { id: "tampered", customer: 0, hoursAgo: 18, items: ["gulab-jamun", "masala-dosa"], issue: "damaged", selected: "gulab-jamun", damage: { issue: "spilled", severity: "partial" }, dispatch: { confidence: "high" }, handoff: "intact", tampered: true },
];

type MenuId = keyof typeof SEED_MENU;
const BASKETS: MenuId[][] = [
  ["biryani", "raita"],
  ["biryani", "gulab-jamun"],
  ["paneer-tikka", "butter-naan"],
  ["dal-makhani", "butter-naan", "raita"],
  ["masala-dosa", "mango-lassi"],
  ["biryani", "paneer-tikka", "mango-lassi"],
  ["dal-makhani", "gulab-jamun"],
  ["masala-dosa"],
];

/** Deterministic PRNG (mulberry32), so the demo looks the same on every reload. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const HISTORY_DAYS = 13;

/** Settled history for the charts: 2–5 claims a day over the past 13 days, all through the real engine. */
function historyScenarios(): Scenario[] {
  const rnd = prng(20_261_122);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const out: Scenario[] = [];
  for (let day = 1; day <= HISTORY_DAYS; day++) {
    const n = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const items = pick(BASKETS);
      const selected = pick(items);
      const base = { id: `h${day}-${k}`, customer: Math.floor(rnd() * CUSTOMERS.length), hoursAgo: day * 24 + rnd() * 14 - 4, items, selected };
      const sources: [InferenceSource, InferenceSource | null] = [rnd() < 0.7 ? "ON_DEVICE" : "IN_CLOUD", rnd() < 0.7 ? "ON_DEVICE" : "IN_CLOUD"];
      const severity = pick(["minor", "partial", "partial", "total"] as const);
      const damage = { issue: pick(["spilled", "crushed"] as const), severity };
      const r = rnd();
      if (r < 0.38) out.push({ ...base, issue: "damaged", damage, dispatch: { confidence: "high" }, handoff: "intact", sources });
      else if (r < 0.48) out.push({ ...base, issue: "damaged", damage, dispatch: { confidence: "high", damageVisible: true }, handoff: "intact", sources });
      else if (r < 0.6) out.push({ ...base, issue: "missing", dispatch: { confidence: "high" }, handoff: "intact", sources: [sources[0], null] });
      else if (r < 0.68) out.push({ ...base, issue: "missing", dispatch: { confidence: "high" }, handoff: "broken", sources: [sources[0], null] });
      else if (r < 0.74) out.push({ ...base, issue: "damaged", damage, dispatch: { confidence: "high" }, handoff: null, hold: "settled", sources });
      else if (r < 0.8) out.push({ ...base, issue: "missing", dispatch: null, handoff: "intact", hold: "accepted", sources: [sources[0], null] });
      else if (r < 0.84) out.push({ ...base, issue: "damaged", damage, dispatch: { confidence: "high" }, handoff: "intact", claims30d: 3, sources });
      else {
        const fraud = pick([{ wrongCode: true, moire: 0.58, screen: true }, { wrongFingers: true, late: true }, { wrongCode: true }, { moire: 0.47 }]);
        out.push({ ...base, issue: "damaged", damage: { issue: damage.issue, severity: "total" }, dispatch: { confidence: "high" }, handoff: "intact", fraud, sources });
      }
    }
  }
  return out;
}

const EXTRA_ORDERS: (keyof typeof SEED_MENU)[][] = [["biryani", "raita"], ["masala-dosa", "mango-lassi"], ["paneer-tikka", "butter-naan"], ["gulab-jamun"]];

/** Stable, realistic-looking ids (FNV-1a) so the pages don't show scenario names. */
function hex(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function seal(i: number): string {
  return String((4721 + i * 1379) % 10000).padStart(4, "0");
}

export function buildDemoData(restaurantId: string, now = Date.now()): DemoData {
  const policy = defaultPolicy;
  const data: DemoData = {
    orders: [],
    decisions: new Map(),
    holds: new Map(),
    resolutions: new Map(),
    audits: new Map(),
    claims: new Map(),
    cases: new Map(),
  };

  // Built here, not at module level: a top-level call would keep this dev-only module in production bundles.
  const scenarios: Scenario[] = [...HANDMADE, ...historyScenarios()];
  scenarios.forEach((s, i) => {
    const orderId = `demo-o-${hex(`${s.id}/order`)}`;
    const claimId = `demo-c-${hex(s.id)}`;
    const customerId = CUSTOMERS[s.customer] ?? "demoCustomer000";
    const code = seal(i);
    const at = now - s.hoursAgo * H;
    const items = s.items.map((id) => ({ id, name: SEED_MENU[id]?.name ?? id, price: SEED_MENU[id]?.price ?? 0 }));
    const total = items.reduce((t, x) => t + x.price, 0);
    const order: OrderDoc = {
      id: orderId,
      restaurantId,
      customerId,
      items,
      total,
      status: "delivered",
      sealCode: code,
      createdAt: at - 1.2 * H,
      dispatchedAt: at - H,
      deliveredAt: at - 0.4 * H,
    };
    const dispatchCheck: DispatchCheck | null = s.dispatch
      ? {
          seal_intact: true,
          seal_code_read: code,
          spill_or_damage_visible: s.dispatch.damageVisible ?? false,
          confidence: s.dispatch.confidence,
        }
      : null;
    const dispatch: DispatchDoc | null = dispatchCheck
      ? { orderId, check: dispatchCheck, inferenceSource: i % 3 === 0 ? "IN_CLOUD" : "ON_DEVICE", imageSha256: "0".repeat(64), thumbRef: null, capturedAt: at - H }
      : null;
    const handoff: HandoffDoc | null = s.handoff
      ? { orderId, check: { seal_state: s.handoff, seal_code_read: code, confidence: "high" }, inferenceSource: "ON_DEVICE", capturedAt: at - 0.4 * H }
      : null;

    const f = s.fraud ?? {};
    const issuedAt = at - 70_000;
    const fingers = 2;
    const challengeCheck: ChallengeCheck = {
      seal_code_read: f.wrongCode ? seal(i + 7) : code,
      fingers_visible: f.wrongFingers ? 3 : fingers,
      seal_state: "broken",
      photo_of_screen_suspected: f.screen ?? false,
      confidence: "high",
    };
    const selectedItem = items.find((it) => it.id === s.selected);
    const damageCheck: DamageCheck | null =
      s.issue === "missing" || !s.damage ? null : { matched_item: selectedItem?.name ?? "", issue: s.damage.issue, severity: s.damage.severity, confidence: "high" };
    const [srcChallenge, srcDamage] = s.sources ?? (["ON_DEVICE", damageCheck ? "ON_DEVICE" : null] as const);
    const claim: ClaimDoc = {
      claimId,
      orderId,
      customerId,
      issueType: s.issue,
      selectedItemIds: [s.selected],
      challenge: {
        kind: "fingers",
        code,
        fingers,
        issuedAt,
        capturedAt: issuedAt + (f.late ? 95_000 : 14_000),
        expiresAt: issuedAt + policy.challengeWindowSec * 1000,
      },
      challengeCheck,
      damageCheck,
      moireScore: f.moire ?? 0.07 + (i % 5) * 0.03,
      cropSha256: damageCheck ? "0".repeat(64) : null,
      cropRef: damageCheck ? `demo/${claimId}/crop.jpg` : null,
      inferenceSources: { challenge: srcChallenge, damage: damageCheck ? (srcDamage ?? "ON_DEVICE") : null },
      customerClaims30d: s.claims30d ?? 0,
      createdAt: at,
    };
    const docs: CaseDocs = { order, dispatch, handoff, claim };
    const review = { status: "ok" as const, consistent: true, flags: [] };
    const input = {
      order: { id: orderId, items, total, sealCode: code },
      dispatch: dispatchCheck ? { check: dispatchCheck } : null,
      handoff: handoff ? { check: handoff.check } : null,
      claim: {
        issueType: claim.issueType,
        selectedItemIds: claim.selectedItemIds,
        challenge: claim.challenge,
        challengeCheck,
        damageCheck,
        moireScore: claim.moireScore,
        customerClaims30d: claim.customerClaims30d,
      },
      review,
      policy,
    };
    const real: EngineDecision = decide(input);
    const written: EngineDecision =
      s.tampered && real.refundAmount > 0 ? { ...real, liability: { restaurant: real.refundAmount, transit: 0, platform: 0 } } : real;

    data.orders.push(order);
    data.claims.set(claimId, claim);
    data.cases.set(claimId, docs);
    data.decisions.set(claimId, {
      claimId,
      orderId,
      customerId,
      restaurantId,
      ...written,
      review,
      explanationRestaurant: explanationFor(written),
      engine: "kotlin",
      createdAt: at + 9_000,
    });

    if (written.verdict === "hold") {
      const state = s.hold ?? "held";
      data.holds.set(claimId, {
        claimId,
        customerId,
        restaurantId,
        amount: written.refundAmount,
        parties: written.liability,
        state,
        holdHours: written.holdHours ?? policy.holdHours,
        createdAt: at + 9_000,
        resolvedAt: state === "held" ? null : at + 20 * H,
      });
      if (s.counter) {
        const counter: DispatchCheck =
          s.counter === "clear"
            ? { seal_intact: true, seal_code_read: code, spill_or_damage_visible: false, confidence: "high" }
            : { seal_intact: true, seal_code_read: "", spill_or_damage_visible: false, confidence: "low" };
        const r = resolveCounterEvidence(input, written, counter);
        data.resolutions.set(claimId, { claimId, ...r, createdAt: at + 20 * H });
      }
    }

    if (!s.unaudited) {
      data.audits.set(claimId, {
        claimId,
        match: !s.tampered,
        mismatchFields: s.tampered ? ["liability.restaurant", "liability.transit"] : [],
        cropHashMatch: damageCheck ? true : null,
        policyVersion: policy.policyVersion,
        auditedAt: at + 60_000,
      });
    }
  });

  EXTRA_ORDERS.forEach((ids, j) => {
    const items = ids.map((id) => ({ id, name: SEED_MENU[id]?.name ?? id, price: SEED_MENU[id]?.price ?? 0 }));
    const at = now - (4 + j * 9) * H;
    data.orders.push({
      id: `demo-o-${hex(`quiet-${j}`)}`,
      restaurantId,
      customerId: CUSTOMERS[j] ?? "demoCustomer000",
      items,
      total: items.reduce((t, x) => t + x.price, 0),
      status: j === 0 ? "dispatched" : "delivered",
      sealCode: seal(40 + j),
      createdAt: at,
      dispatchedAt: at + 0.3 * H,
      deliveredAt: j === 0 ? null : at + H,
    });
  });
  // Orders without a claim, so the claim rate has a denominator (about 70–95 a day, ~4% claimed).
  const rnd = prng(7);
  for (let day = 0; day <= HISTORY_DAYS; day++) {
    const n = 70 + Math.floor(rnd() * 26);
    for (let k = 0; k < n; k++) {
      const ids = BASKETS[Math.floor(rnd() * BASKETS.length)] ?? ["masala-dosa"];
      const items = ids.map((id) => ({ id, name: SEED_MENU[id]?.name ?? id, price: SEED_MENU[id]?.price ?? 0 }));
      const at = now - (day * 24 + 2 + rnd() * 12) * H;
      data.orders.push({
        id: `demo-o-${hex(`bg-${day}-${k}`)}`,
        restaurantId,
        customerId: CUSTOMERS[k % CUSTOMERS.length] ?? "demoCustomer000",
        items,
        total: items.reduce((t, x) => t + x.price, 0),
        status: "delivered",
        sealCode: seal(100 + day * 50 + k),
        createdAt: at,
        dispatchedAt: at + 0.3 * H,
        deliveredAt: at + H,
      });
    }
  }
  return data;
}

function explanationFor(d: EngineDecision): string {
  switch (d.liabilityCase) {
    case "handling_damage":
      return "The bag left sealed with the right code and no visible damage, and it was still sealed at handoff, so the damage happened in transit. The restaurant is not charged.";
    case "restaurant_not_packed":
      return "The parcel left sealed with this order's code and the seal was still intact at handoff, so nobody opened it on the way: the item was never packed.";
    case "transit_tamper":
      return "The parcel left sealed with this order's code, but the seal was broken before the customer opened it, so it was opened in transit.";
    default:
      return d.verdict === "review"
        ? "The claim photo did not pass the evidence checks, so no refund was made automatically. A reviewer will look at it."
        : "Responsibility is unclear from the evidence, so the refund is held and split until the restaurant responds or the window ends.";
  }
}

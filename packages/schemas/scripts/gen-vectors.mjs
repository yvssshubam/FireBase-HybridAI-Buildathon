// Builds the shared test vectors from compact case definitions.
// EVERY `expect` below is computed by hand from PLAN §8 + the agreed defaults
// (see test-vectors/README.md) — never by running the engine. Both the TS and
// the Kotlin engine are tested against the generated JSON.
// Usage: node scripts/gen-vectors.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "test-vectors");
const clone = (x) => structuredClone(x);
const merge = (base, patch) => ({ ...clone(base), ...clone(patch) });

// ---------- fixtures ----------
const ORDER = {
  id: "order-1",
  items: [
    { id: "biryani", name: "Chicken Biryani", price: 380 },
    { id: "gulab-jamun", name: "Gulab Jamun", price: 180 },
    { id: "raita", name: "Raita", price: 80 },
  ],
  total: 640,
  sealCode: "4721",
};
const ALL_VISIBLE = ["Chicken Biryani", "Gulab Jamun", "Raita"];
const D = (o = {}) => ({
  check: merge(
    { seal_intact: true, seal_code_read: "4721", visible_item_count: 3, visible_items: ALL_VISIBLE, spill_or_damage_visible: false, confidence: "high" },
    o,
  ),
});
const H = (seal_state, o = {}) => ({ check: merge({ seal_state, seal_code_read: "4721", confidence: "high" }, o) });
const ISSUED = 1_700_000_000_000;
const CHALLENGE = { kind: "fingers", code: "4721", fingers: 2, issuedAt: ISSUED, capturedAt: ISSUED + 20_000, expiresAt: ISSUED + 60_000 };
const CC = { seal_code_read: "4721", fingers_visible: 2, seal_state: "broken", photo_of_screen_suspected: false, confidence: "high" };
const DMG = { matched_item: "Gulab Jamun", issue: "spilled", severity: "partial", confidence: "medium" };
const WRONG_DMG = { matched_item: "Mango Lassi", issue: "wrong_item", severity: "none", confidence: "medium" };
const REVIEW_OK = { status: "ok", consistent: true, flags: [] };

const CLAIM = {
  damaged: { issueType: "damaged", selectedItemIds: ["gulab-jamun"], challenge: CHALLENGE, challengeCheck: CC, damageCheck: DMG, moireScore: 0.1, customerClaims30d: 0 },
  missing: { issueType: "missing", selectedItemIds: ["gulab-jamun"], challenge: CHALLENGE, challengeCheck: CC, damageCheck: null, moireScore: 0.1, customerClaims30d: 0 },
  wrong_item: { issueType: "wrong_item", selectedItemIds: ["raita"], challenge: CHALLENGE, challengeCheck: CC, damageCheck: WRONG_DMG, moireScore: 0.1, customerClaims30d: 0 },
};

/** Build an engine input. `c` patches the claim; `cc`/`dmg` patch nested checks. */
function input({ type = "damaged", order = ORDER, dispatch = D(), handoff = H("intact"), c = {}, cc = {}, dmg, review = REVIEW_OK } = {}) {
  const claim = merge(CLAIM[type], c);
  claim.challengeCheck = merge(claim.challengeCheck, cc);
  if (dmg === null) claim.damageCheck = null;
  else if (dmg) claim.damageCheck = merge(claim.damageCheck ?? DMG, dmg);
  return { order: clone(order), dispatch: clone(dispatch), handoff: clone(handoff), claim, review: clone(review) };
}

/** Expected decision. liab = [restaurant, transit, platform]; split = [restaurant‰, transit‰] | null. */
function expect({ verdict, refund, assessed, liab = [0, 0, 0], kase, split = null, reasons }) {
  return {
    verdict,
    refundAmount: refund,
    assessedAmount: assessed,
    currency: "INR",
    liability: { restaurant: liab[0], transit: liab[1], platform: liab[2] },
    liabilityCase: kase,
    split: split && { restaurantPermille: split[0], transitPermille: split[1] },
    reasons,
    holdHours: verdict === "hold" ? 48 : null,
    policyVersion: "v1",
  };
}
const auto = (amount, party, kase, reasons) =>
  expect({ verdict: "auto_refund", refund: amount, assessed: amount, liab: [party === "restaurant" ? amount : 0, party === "transit" ? amount : 0, party === "platform" ? amount : 0], kase, reasons });
const hold = (amount, liab, split, kase, reasons) => expect({ verdict: "hold", refund: amount, assessed: amount, liab, split, kase, reasons });
const review = (assessed, kase, reasons) => expect({ verdict: "review", refund: 0, assessed, kase, reasons });

const DV = "dispatch_valid", DM = "dispatch_missing", DI = "dispatch_invalid";
const HI = "handoff_intact", HB = "handoff_broken", HM = "handoff_missing", HU = "handoff_unusable";

// ---------- engine vectors ----------
const engine = [];
const add = (name, matrixRow, inp, expected, policyPatch) => engine.push({ name, matrixRow, ...(policyPatch ? { policyPatch } : {}), input: inp, expected });

// Verification gate (§8.1). Base: damaged, clean dispatch (high), handoff intact → 0.6 × 180 = 108 to transit.
add("gate: happy path verified", "8.1", input(), auto(108, "transit", "handling_damage", [DV, HI]));
add("gate: seal code mismatch", "8.1", input({ cc: { seal_code_read: "4712" } }), review(108, "handling_damage", [DV, HI, "gate_code_mismatch"]));
add("gate: seal code unreadable", "8.1", input({ cc: { seal_code_read: "" } }), review(108, "handling_damage", [DV, HI, "gate_code_mismatch"]));
add("gate: fingers mismatch", "8.1", input({ cc: { fingers_visible: 3 } }), review(108, "handling_damage", [DV, HI, "gate_fingers_mismatch"]));
add("gate: captured exactly at window end passes", "8.1", input({ c: { challenge: { ...CHALLENGE, capturedAt: ISSUED + 60_000 } } }), auto(108, "transit", "handling_damage", [DV, HI]));
add("gate: captured 1 ms after window", "8.1", input({ c: { challenge: { ...CHALLENGE, capturedAt: ISSUED + 60_001 } } }), review(108, "handling_damage", [DV, HI, "gate_window_expired"]));
add("gate: captured before issued", "8.1", input({ c: { challenge: { ...CHALLENGE, capturedAt: ISSUED - 1 } } }), review(108, "handling_damage", [DV, HI, "gate_time_invalid"]));
add("gate: moire exactly at threshold fails", "8.1", input({ c: { moireScore: 0.35 } }), review(108, "handling_damage", [DV, HI, "gate_moire_high"]));
add("gate: moire just under threshold passes", "8.1", input({ c: { moireScore: 0.3499 } }), auto(108, "transit", "handling_damage", [DV, HI]));
add("gate: screen suspected on device", "8.1", input({ cc: { photo_of_screen_suspected: true } }), review(108, "handling_damage", [DV, HI, "gate_screen_suspected"]));
add("gate: challenge check low confidence", "8.1", input({ cc: { confidence: "low" } }), review(108, "handling_damage", [DV, HI, "gate_challenge_low_confidence"]));
add("gate: damage check low confidence", "8.1", input({ dmg: { confidence: "low" } }), review(108, "handling_damage", [DV, HI, "gate_damage_low_confidence"]));
add("gate: damaged claim without damage check", "8.1", input({ dmg: null }), review(0, "handling_damage", [DV, HI, "gate_damage_check_missing"]));
add(
  "gate: several failures are all reported in order",
  "8.1",
  input({ c: { moireScore: 0.9 }, cc: { seal_code_read: "1234", fingers_visible: 1, photo_of_screen_suspected: true } }),
  review(108, "handling_damage", [DV, HI, "gate_code_mismatch", "gate_fingers_mismatch", "gate_moire_high", "gate_screen_suspected"]),
);
add(
  "gate: order never dispatched (no seal code)",
  "8.1",
  input({ order: { ...ORDER, sealCode: null }, dispatch: null, handoff: null }),
  review(108, "hold_no_dispatch", [DM, HM, "gate_code_mismatch"]),
);

// Claim item consistency.
add("claim: selected item not in order", "claim", input({ c: { selectedItemIds: ["naan"] } }), review(0, "undetermined", [DV, HI, "claim_items_invalid"]));
add("claim: damaged with two items selected", "claim", input({ c: { selectedItemIds: ["gulab-jamun", "raita"] } }), review(0, "undetermined", [DV, HI, "claim_items_invalid"]));
add("claim: duplicate missing items", "claim", input({ type: "missing", c: { selectedItemIds: ["raita", "raita"] } }), review(0, "undetermined", [DV, HI, "claim_items_invalid"]));
add("claim: nothing selected", "claim", input({ type: "missing", c: { selectedItemIds: [] } }), review(0, "undetermined", [DV, HI, "claim_items_invalid"]));
add("claim: crop shows no damage", "claim", input({ dmg: { issue: "none", severity: "none" } }), review(0, "handling_damage", [DV, HI, "damage_none_on_crop"]));
add("claim: severity none with a damage issue", "claim", input({ dmg: { severity: "none" } }), review(0, "handling_damage", [DV, HI, "damage_none_on_crop"]));
add("claim: crop issue is not a damage type", "claim", input({ dmg: { issue: "missing" } }), review(108, "handling_damage", [DV, HI, "damage_issue_mismatch"]));
add("claim: crop matched a different order item", "claim", input({ dmg: { matched_item: "Raita" } }), review(108, "handling_damage", [DV, HI, "damage_item_mismatch"]));
add("claim: unknown crop item falls back to the customer's pick", "claim", input({ dmg: { matched_item: "dessert cup" } }), auto(108, "transit", "handling_damage", [DV, HI]));
add("claim: crop item matched case-insensitively", "claim", input({ dmg: { matched_item: "gulab jamun " } }), auto(108, "transit", "handling_damage", [DV, HI]));

// Damage / spill matrix (§8.2 table 2 + defaults 1–3).
add("damage: clean high dispatch + intact handoff → transit handling", "8.2.damage.1", input(), auto(108, "transit", "handling_damage", [DV, HI]));
add("damage: damage visible at dispatch → restaurant", "8.2.damage.2", input({ dispatch: D({ spill_or_damage_visible: true }) }), auto(108, "restaurant", "restaurant_damage_at_dispatch", [DV, HI]));
add("damage: damage visible at dispatch, no handoff → restaurant", "8.2.damage.2", input({ dispatch: D({ spill_or_damage_visible: true }), handoff: null }), auto(108, "restaurant", "restaurant_damage_at_dispatch", [DV, HM]));
add("damage: damage visible at dispatch, medium confidence → restaurant", "8.2.damage.2", input({ dispatch: D({ spill_or_damage_visible: true, confidence: "medium" }) }), auto(108, "restaurant", "restaurant_damage_at_dispatch", [DV, HI]));
// medium: shift = 200 × 600/1000 = 120 toward transit → 380‰; 108×380 = 41040 (+500) /1000 → 41; transit 67
add("damage: clean dispatch medium confidence → weighted hold", "8.2.damage.3", input({ dispatch: D({ confidence: "medium" }) }), hold(108, [41, 67, 0], [380, 620], "hold_damage_dispatch_uncertain", [DV, HI]));
// low: shift 60 → 440‰; 108×440 = 47520 → 48; transit 60
add("damage: clean dispatch low confidence, broken handoff → weighted hold", "8.2.damage.3", input({ dispatch: D({ confidence: "low" }), handoff: H("broken") }), hold(108, [48, 60, 0], [440, 560], "hold_damage_dispatch_uncertain", [DV, HB]));
add("damage: no dispatch evidence → neutral hold", "8.2.damage.4", input({ dispatch: null }), hold(108, [54, 54, 0], [500, 500], "hold_no_dispatch", [DM, HI]));
add("damage: no dispatch, no handoff → neutral hold", "8.2.damage.4", input({ dispatch: null, handoff: null }), hold(108, [54, 54, 0], [500, 500], "hold_no_dispatch", [DM, HM]));
add("damage: no dispatch, broken handoff stays neutral (seal can't answer spills)", "8.2.damage.4", input({ dispatch: null, handoff: H("broken") }), hold(108, [54, 54, 0], [500, 500], "hold_no_dispatch", [DM, HB]));
add("damage: clean high dispatch + broken handoff → transit (default 3)", "default.3", input({ handoff: H("broken") }), auto(108, "transit", "handling_damage", [DV, HB]));
// high, no handoff: shift 200 toward transit → 300‰; 108×300 = 32400 → 32; transit 76
add("damage: clean high dispatch, no handoff → weighted hold (default 1)", "default.1", input({ handoff: null }), hold(108, [32, 76, 0], [300, 700], "hold_damage_no_handoff", [DV, HM]));
add("damage: dispatch seal not intact counts as no dispatch (default 4)", "default.4", input({ dispatch: D({ seal_intact: false }) }), hold(108, [54, 54, 0], [500, 500], "hold_no_dispatch", [DI, HI]));
add("damage: dispatch wrong code counts as no dispatch (default 4)", "default.4", input({ dispatch: D({ seal_code_read: "4712" }) }), hold(108, [54, 54, 0], [500, 500], "hold_no_dispatch", [DI, HI]));
add("damage: handoff seal not visible counts as no handoff (default 2)", "default.2", input({ handoff: H("not_visible") }), hold(108, [32, 76, 0], [300, 700], "hold_damage_no_handoff", [DV, HU]));
add("damage: handoff code unreadable counts as no handoff (default 2)", "default.2", input({ handoff: H("intact", { seal_code_read: "" }) }), hold(108, [32, 76, 0], [300, 700], "hold_damage_no_handoff", [DV, HU]));
add("damage: handling liability follows policy", "8.2.damage.1", input(), auto(108, "platform", "handling_damage", [DV, HI]), { handlingDamageLiable: "platform" });

// Proportionate refund, caps and history (§8.3, §8.4, default 5).
add("refund: minor = 0.3 × 180", "8.3", input({ dmg: { severity: "minor" } }), auto(54, "transit", "handling_damage", [DV, HI]));
add("refund: total = 1.0 × 180", "8.3", input({ dmg: { severity: "total" } }), auto(180, "transit", "handling_damage", [DV, HI]));
add(
  "refund: main dish total",
  "8.3",
  input({ c: { selectedItemIds: ["biryani"] }, dmg: { matched_item: "Chicken Biryani", severity: "total" } }),
  auto(380, "transit", "handling_damage", [DV, HI]),
);
const LASSI = { id: "order-2", items: [{ id: "lassi", name: "Mango Lassi", price: 75 }], total: 75, sealCode: "4721" };
const LASSI_D = D({ visible_item_count: 1, visible_items: ["Mango Lassi"] });
const lassi = (o) => input({ order: LASSI, dispatch: LASSI_D, c: { selectedItemIds: ["lassi"] }, ...o });
add("refund: 22.5 rounds half up to 23", "8.3", lassi({ dmg: { matched_item: "Mango Lassi", severity: "minor" } }), auto(23, "transit", "handling_damage", [DV, HI]));
add("refund: 21.3 rounds down to 21", "8.3", input({ order: { ...LASSI, items: [{ id: "lassi", name: "Mango Lassi", price: 71 }], total: 71 }, dispatch: LASSI_D, c: { selectedItemIds: ["lassi"] }, dmg: { matched_item: "Mango Lassi", severity: "minor" } }), auto(21, "transit", "handling_damage", [DV, HI]));
// 75 × 0.6 = 45; hold 380‰: 45×380 = 17100 → 17; transit 28
add("refund: odd hold split rounds restaurant share half up", "8.4", lassi({ dispatch: D({ visible_item_count: 1, visible_items: ["Mango Lassi"], confidence: "medium" }), dmg: { matched_item: "Mango Lassi" } }), hold(45, [17, 28, 0], [380, 620], "hold_damage_dispatch_uncertain", [DV, HI]));
add("risk: refund above auto-approve cap → review (default 5)", "default.5", input({ dmg: { severity: "total" } }), review(180, "handling_damage", [DV, HI, "over_auto_approve_cap"]), { autoApproveCap: 100 });
add("risk: refund equal to cap is still instant", "8.4", input({ dmg: { severity: "total" } }), auto(180, "transit", "handling_damage", [DV, HI]), { autoApproveCap: 180 });
add("risk: 3 claims in 30 days → review (default 5)", "default.5", input({ c: { customerClaims30d: 3 } }), review(108, "handling_damage", [DV, HI, "claim_history_limit"]));
add("risk: 2 claims in 30 days still instant", "8.4", input({ c: { customerClaims30d: 2 } }), auto(108, "transit", "handling_damage", [DV, HI]));
add("risk: hold above cap → review", "default.5", input({ dispatch: D({ confidence: "medium" }) }), review(108, "hold_damage_dispatch_uncertain", [DV, HI, "over_auto_approve_cap"]), { autoApproveCap: 100 });

// Missing items (§8.2 table 1). Gulab Jamun missing → 1.0 × 180.
const ABSENT = D({ visible_item_count: 2, visible_items: ["Chicken Biryani", "Raita"] });
const m = (o) => input({ type: "missing", ...o });
add("missing: packed + broken at handoff → transit", "8.2.missing.1", m({ handoff: H("broken") }), auto(180, "transit", "transit_tamper", [DV, HB]));
add("missing: packed + intact at handoff → investigate hold", "8.2.missing.2", m(), hold(180, [90, 90, 0], [500, 500], "hold_investigate_contradiction", [DV, HI]));
add("missing: not packed + intact at handoff → restaurant", "8.2.missing.3", m({ dispatch: ABSENT }), auto(180, "restaurant", "restaurant_not_packed", [DV, HI]));
// high toward transit → 300‰: 180×300 = 54000 → 54; 126
add("missing: packed, no handoff → hold weighted to transit", "8.2.missing.4", m({ handoff: null }), hold(180, [54, 126, 0], [300, 700], "hold_no_handoff", [DV, HM]));
add("missing: not packed, no handoff → hold weighted to restaurant", "8.2.missing.4", m({ dispatch: ABSENT, handoff: null }), hold(180, [126, 54, 0], [700, 300], "hold_no_handoff", [DV, HM]));
// medium toward transit → 380‰: 180×380 = 68400 → 68; 112
add("missing: packed (medium), no handoff → weaker shift", "8.2.missing.4", m({ dispatch: D({ confidence: "medium" }), handoff: null }), hold(180, [68, 112, 0], [380, 620], "hold_no_handoff", [DV, HM]));
add("missing: handoff seal not visible counts as no handoff", "default.2", m({ handoff: H("not_visible") }), hold(180, [54, 126, 0], [300, 700], "hold_no_handoff", [DV, HU]));
add("missing: no dispatch, intact handoff → hold weighted to restaurant", "8.2.missing.5", m({ dispatch: null }), hold(180, [126, 54, 0], [700, 300], "hold_no_dispatch", [DM, HI]));
// medium handoff toward restaurant → 620‰: 180×620 = 111600 → 112; 68
add("missing: no dispatch, intact handoff (medium) → weaker shift", "8.2.missing.5", m({ dispatch: null, handoff: H("intact", { confidence: "medium" }) }), hold(180, [112, 68, 0], [620, 380], "hold_no_dispatch", [DM, HI]));
add("missing: no dispatch, broken handoff → hold weighted to transit", "8.2.missing.5", m({ dispatch: null, handoff: H("broken") }), hold(180, [54, 126, 0], [300, 700], "hold_no_dispatch", [DM, HB]));
add("missing: no dispatch, no handoff → neutral hold", "8.2.missing.5", m({ dispatch: null, handoff: null }), hold(180, [90, 90, 0], [500, 500], "hold_no_dispatch", [DM, HM]));
add("missing: not packed + broken at handoff → hold weighted to restaurant (default 1)", "default.1", m({ dispatch: ABSENT, handoff: H("broken") }), hold(180, [126, 54, 0], [700, 300], "hold_absent_and_tampered", [DV, HB]));
add(
  "missing: dispatch names unclear, count full → neutral hold",
  "default.1",
  m({ dispatch: D({ visible_items: ["rice box", "dessert", "curd"] }) }),
  hold(180, [90, 90, 0], [500, 500], "hold_item_status_unclear", [DV, HI]),
);
add(
  "missing: two items not packed → restaurant, summed",
  "8.2.missing.3",
  m({ dispatch: D({ visible_item_count: 1, visible_items: ["Chicken Biryani"] }), c: { selectedItemIds: ["gulab-jamun", "raita"] } }),
  auto(260, "restaurant", "restaurant_not_packed", [DV, HI]),
);
add(
  "missing: one packed and one not → neutral hold",
  "default.1",
  m({ dispatch: D({ visible_item_count: 2, visible_items: ["Chicken Biryani", "Gulab Jamun"] }), c: { selectedItemIds: ["gulab-jamun", "raita"] } }),
  hold(260, [130, 130, 0], [500, 500], "hold_item_status_unclear", [DV, HI]),
);
add(
  "missing: whole order capped at discounted total",
  "8.3",
  m({ order: { ...ORDER, total: 500 }, handoff: H("broken"), c: { selectedItemIds: ["biryani", "gulab-jamun", "raita"] } }),
  auto(500, "transit", "transit_tamper", [DV, HB, "refund_capped_at_order_total"]),
);
add("missing: dispatch name match by whole words", "8.2.missing.1", m({ dispatch: D({ visible_items: ["chicken biryani box", "gulab jamun", "raita cup"] }), handoff: H("broken") }), auto(180, "transit", "transit_tamper", [DV, HB]));
add("missing: name match wins over a short count", "8.2.missing.2", m({ dispatch: D({ visible_item_count: 1, visible_items: ["Gulab Jamun"] }) }), hold(180, [90, 90, 0], [500, 500], "hold_investigate_contradiction", [DV, HI]));
add("missing: claim-photo seal state is ignored for liability", "8.2.key-rule", m({ handoff: H("broken"), cc: { seal_state: "intact" } }), auto(180, "transit", "transit_tamper", [DV, HB]));
add("missing: plan rows ignore dispatch confidence", "8.2.missing.3", m({ dispatch: D({ visible_item_count: 2, visible_items: ["Chicken Biryani", "Raita"], confidence: "low" }) }), auto(180, "restaurant", "restaurant_not_packed", [DV, HI]));

// Wrong item (§8.2 "Wrong item" + defaults). Raita replaced → 1.0 × 80.
const NO_RAITA = D({ visible_item_count: 2, visible_items: ["Chicken Biryani", "Gulab Jamun"] });
const w = (o) => input({ type: "wrong_item", ...o });
add("wrong: wrong at dispatch → restaurant", "8.2.wrong.1", w({ dispatch: NO_RAITA }), auto(80, "restaurant", "restaurant_not_packed", [DV, HI]));
add("wrong: correct at dispatch + intact handoff → investigate hold", "8.2.wrong.2", w(), hold(80, [40, 40, 0], [500, 500], "hold_investigate_contradiction", [DV, HI]));
add("wrong: correct at dispatch + broken handoff → transit (default 3)", "default.3", w({ handoff: H("broken") }), auto(80, "transit", "transit_tamper", [DV, HB]));
// 80×300 = 24000 → 24; 56
add("wrong: correct at dispatch, no handoff → hold weighted to transit", "default.1", w({ handoff: null }), hold(80, [24, 56, 0], [300, 700], "hold_no_handoff", [DV, HM]));
// 80×700 = 56000 → 56; 24
add("wrong: no dispatch, intact handoff → hold weighted to restaurant", "default.1", w({ dispatch: null }), hold(80, [56, 24, 0], [700, 300], "hold_no_dispatch", [DM, HI]));
add("wrong: crop looks like the ordered item → review", "claim", w({ dmg: { matched_item: "Raita" } }), review(80, "hold_investigate_contradiction", [DV, HI, "wrong_item_disputed"]));
add("wrong: no damage check → review", "8.1", w({ dmg: null }), review(80, "hold_investigate_contradiction", [DV, HI, "gate_damage_check_missing"]));
add("wrong: crop low confidence → review", "8.1", w({ dmg: { confidence: "low" } }), review(80, "hold_investigate_contradiction", [DV, HI, "gate_damage_low_confidence"]));
add("wrong: two items selected → review", "claim", w({ c: { selectedItemIds: ["raita", "biryani"] } }), review(0, "undetermined", [DV, HI, "claim_items_invalid"]));

// Cloud review (§8.4 last bullet + hard rule "degrade to review").
add("review: preliminary decision (review not run yet)", "8.4", input({ review: null }), auto(108, "transit", "handling_damage", [DV, HI]));
add("review: contradiction flagged", "8.4", input({ review: { status: "ok", consistent: false, flags: ["dispatch_contradiction"] } }), review(108, "handling_damage", [DV, HI, "cloud_review_flagged"]));
add("review: consistent but with a flag", "8.4", input({ review: { status: "ok", consistent: true, flags: ["other"] } }), review(108, "handling_damage", [DV, HI, "cloud_review_flagged"]));
add("review: unavailable after retry", "hard-rule", input({ review: { status: "unavailable" } }), review(108, "handling_damage", [DV, HI, "cloud_review_unavailable"]));
add("review: flag downgrades a hold", "8.4", input({ dispatch: D({ confidence: "medium" }), review: { status: "ok", consistent: false, flags: ["other"] } }), review(108, "hold_damage_dispatch_uncertain", [DV, HI, "cloud_review_flagged"]));
add("review: gate failure and review failure both listed", "8.1", input({ cc: { fingers_visible: 1 }, review: { status: "unavailable" } }), review(108, "handling_damage", [DV, HI, "gate_fingers_mismatch", "cloud_review_unavailable"]));

// ---------- counter-evidence vectors (Flow E) ----------
const CE = (o = {}) => D(o).check;
const counter = [];
const addC = (name, inp, check, expected, policyPatch) => counter.push({ name, ...(policyPatch ? { policyPatch } : {}), input: inp, counterCheck: check, expected });
const settled = (refund, liab, reasons) => ({ outcome: "settled", refundAmount: refund, liability: { restaurant: liab[0], transit: liab[1], platform: liab[2] }, reasons, policyVersion: "v1" });
const escalated = (refund, reasons) => ({ outcome: "review", refundAmount: refund, liability: { restaurant: 0, transit: 0, platform: 0 }, reasons, policyVersion: "v1" });

addC("counter: clear photo settles a no-dispatch damage hold on transit", input({ dispatch: null }), CE(), settled(108, [0, 108, 0], ["counter_evidence_clear"]));
addC("counter: medium confidence is not clear → human review", input({ dispatch: null }), CE({ confidence: "medium" }), escalated(108, ["counter_evidence_unclear"]));
addC("counter: wrong seal code → human review", input({ dispatch: null }), CE({ seal_code_read: "4712" }), escalated(108, ["counter_evidence_unclear"]));
addC("counter: seal not intact → human review", input({ dispatch: null }), CE({ seal_intact: false }), escalated(108, ["counter_evidence_unclear"]));
addC("counter: damage visible in counter photo → human review", input({ dispatch: null }), CE({ spill_or_damage_visible: true }), escalated(108, ["counter_evidence_unclear"]));
addC("counter: settles an uncertain-dispatch damage hold", input({ dispatch: D({ confidence: "medium" }) }), CE(), settled(108, [0, 108, 0], ["counter_evidence_clear"]));
addC("counter: cannot resolve the packed-and-sealed contradiction", m(), CE(), escalated(180, ["counter_evidence_cannot_resolve_contradiction"]));
addC("counter: conflicts with own dispatch photo (item absent)", m({ dispatch: ABSENT, handoff: null }), CE(), escalated(180, ["counter_evidence_conflicts_dispatch"]));
addC("counter: clear photo settles a no-dispatch missing hold", m({ dispatch: null }), CE(), settled(180, [0, 180, 0], ["counter_evidence_clear"]));
addC("counter: claimed item not visible in counter photo", m({ dispatch: null }), CE({ visible_item_count: 2, visible_items: ["Chicken Biryani", "Raita"] }), escalated(180, ["counter_evidence_unclear"]));
// 108×250 = 27000 → 27; transit 81
addC("counter: policy can keep part of the restaurant share", input({ dispatch: null }), CE(), settled(108, [27, 81, 0], ["counter_evidence_clear"]), { counterEvidence: { restaurantPermilleAfterClear: 250 } });
addC("counter: not allowed on an auto refund", input(), CE(), { error: "not_hold" });
addC("counter: not allowed on a review decision", input({ cc: { fingers_visible: 1 } }), CE(), { error: "not_hold" });

// ---------- model-output vectors ----------
const okD = { seal_intact: true, seal_code_read: "4721", visible_item_count: 2, visible_items: ["biryani box", "dessert cup"], spill_or_damage_visible: false, confidence: "high" };
const js = (o) => JSON.stringify(o);
const longItem = "x".repeat(70);
const longText = "a".repeat(700);
const okR = {
  consistent: true,
  flags: [],
  explanation_customer_en: "Your dessert spilled in transit.",
  explanation_customer_hi: "आपकी मिठाई रास्ते में गिर गई।",
  explanation_customer_ta: "உங்கள் இனிப்பு வழியில் சிந்தியது.",
  explanation_restaurant: "Packed clean and sealed; spilled in transit.",
};
const mo = [];
const addM = (name, kind, text, expected) => mo.push({ name, kind, text, expected });
const ok = (value) => ({ ok: true, value });
const bad = (error) => ({ ok: false, error });

addM("dispatch: exact JSON", "dispatch", js(okD), ok(okD));
addM("dispatch: fenced JSON with prose", "dispatch", "Sure!\n```json\n" + js(okD) + "\n```\n", ok(okD));
addM("dispatch: spaced code", "dispatch", js({ ...okD, seal_code_read: "47 21" }), ok(okD));
addM("dispatch: dashed code", "dispatch", js({ ...okD, seal_code_read: "47-21" }), ok(okD));
addM("dispatch: code with words", "dispatch", js({ ...okD, seal_code_read: "4721 (partly hidden)" }), ok(okD));
addM("dispatch: unreadable code", "dispatch", js({ ...okD, seal_code_read: "unreadable" }), ok({ ...okD, seal_code_read: "" }));
addM("dispatch: numeric code", "dispatch", js({ ...okD, seal_code_read: 4721 }), ok(okD));
addM("dispatch: three-digit code", "dispatch", js({ ...okD, seal_code_read: "472" }), ok({ ...okD, seal_code_read: "" }));
addM("dispatch: five-digit code", "dispatch", js({ ...okD, seal_code_read: "47215" }), ok({ ...okD, seal_code_read: "" }));
addM("dispatch: enum case and spaces", "dispatch", js({ ...okD, confidence: " High " }), ok(okD));
addM("dispatch: extra key dropped", "dispatch", js({ ...okD, notes: "looks fine" }), ok(okD));
addM("dispatch: missing key", "dispatch", js({ ...okD, confidence: undefined }), bad("schema"));
addM("dispatch: fractional count", "dispatch", js({ ...okD, visible_item_count: 2.5 }), bad("schema"));
addM("dispatch: count written as 2.0", "dispatch", js(okD).replace('"visible_item_count":2', '"visible_item_count":2.0'), ok(okD));
addM("dispatch: count too large", "dispatch", js({ ...okD, visible_item_count: 51 }), bad("schema"));
addM("dispatch: items trimmed, truncated, blanks dropped", "dispatch", js({ ...okD, visible_items: ["  biryani box ", "   ", longItem] }), ok({ ...okD, visible_items: ["biryani box", "x".repeat(60)] }));
addM("dispatch: more than 20 items kept to 20", "dispatch", js({ ...okD, visible_items: Array.from({ length: 25 }, (_, i) => `item ${i}`) }), ok({ ...okD, visible_items: Array.from({ length: 20 }, (_, i) => `item ${i}`) }));
addM("dispatch: non-string item", "dispatch", js({ ...okD, visible_items: ["biryani", 3] }), bad("schema"));
addM("dispatch: boolean as string", "dispatch", js({ ...okD, seal_intact: "true" }), bad("schema"));
addM("dispatch: null confidence", "dispatch", js({ ...okD, confidence: null }), bad("schema"));
addM("dispatch: no JSON at all", "dispatch", "I cannot see a seal in this photo.", bad("no_json"));
addM("dispatch: unquoted keys", "dispatch", "{seal_intact: true}", bad("bad_json"));
addM("dispatch: trailing comma", "dispatch", js(okD).replace(/}$/, ",}"), bad("bad_json"));
addM("dispatch: array wrapper is unwrapped to its object", "dispatch", "[" + js(okD) + "]", ok(okD));
addM("handoff: ok", "handoff", js({ seal_state: "BROKEN", seal_code_read: "4721", confidence: "medium" }), ok({ seal_state: "broken", seal_code_read: "4721", confidence: "medium" }));
addM("handoff: unknown seal state", "handoff", js({ seal_state: "torn", seal_code_read: "4721", confidence: "high" }), bad("schema"));
addM(
  "handoff: braces in trailing prose break extraction",
  "handoff",
  'Here {"seal_state":"intact","seal_code_read":"4721","confidence":"high"} hope that helps {smile}',
  bad("bad_json"),
);
const okC = { seal_code_read: "4721", fingers_visible: 2, seal_state: "broken", photo_of_screen_suspected: false, confidence: "high" };
addM("challenge: ok", "challenge", js(okC), ok(okC));
addM("challenge: fingers as string", "challenge", js({ ...okC, fingers_visible: "2" }), bad("schema"));
addM("challenge: fingers out of range", "challenge", js({ ...okC, fingers_visible: 11 }), bad("schema"));
addM("challenge: negative fingers", "challenge", js({ ...okC, fingers_visible: -1 }), bad("schema"));
const okG = { matched_item: "gulab jamun", issue: "spilled", severity: "partial", confidence: "medium" };
addM("damage: ok with normalization", "damage", js({ matched_item: "  gulab jamun ", issue: "Spilled ", severity: "PARTIAL", confidence: "medium" }), ok(okG));
addM("damage: long item truncated", "damage", js({ ...okG, matched_item: longItem }), ok({ ...okG, matched_item: "x".repeat(60) }));
addM("damage: unknown severity", "damage", js({ ...okG, severity: "moderate" }), bad("schema"));
addM("damage: empty matched item allowed", "damage", js({ ...okG, matched_item: "" }), ok({ ...okG, matched_item: "" }));
addM("review: ok with Hindi and Tamil", "review", js(okR), ok(okR));
addM("review: flags normalized, unknown → other, deduped", "review", js({ ...okR, flags: ["Dispatch_Contradiction", "made_up", "other", "dispatch_contradiction"] }), ok({ ...okR, flags: ["dispatch_contradiction", "other"] }));
addM("review: explanation truncated to 600", "review", js({ ...okR, explanation_restaurant: longText }), ok({ ...okR, explanation_restaurant: "a".repeat(600) }));
addM("review: missing Tamil explanation", "review", js({ ...okR, explanation_customer_ta: undefined }), bad("schema"));
addM("review: flags not a list", "review", js({ ...okR, flags: "other" }), bad("schema"));

// ---------- item-name match vectors ----------
const match = [
  ["Chicken Biryani", "chicken biryani", true],
  ["chicken biryani box", "Chicken Biryani", true],
  ["Biryani", "Chicken Biryani", true],
  ["Raita", "Boondi Raita", true],
  ["Gulab-Jamun", "Gulab Jamun", true],
  ["Butter Naan 2pc", "Naan", true],
  ["rice", "Chicken Biryani", false],
  ["an", "Naan", false],
  ["", "Raita", false],
  ["   ", "Raita", false],
  ["दाल", "Dal", false],
].map(([a, b, expected]) => ({ a, b, expected }));

// ---------- write ----------
const files = {
  "engine.vectors.json": engine,
  "counter-evidence.vectors.json": counter,
  "model-output.vectors.json": mo,
  "item-match.vectors.json": match,
};
let stale = false;
for (const [name, data] of Object.entries(files)) {
  const path = join(outDir, name);
  const text = JSON.stringify(data, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    let cur = "";
    try {
      cur = readFileSync(path, "utf8");
    } catch {
      // missing counts as stale
    }
    if (cur !== text) {
      console.error(`${name} is stale — run \`npm run gen\`.`);
      stale = true;
    }
  } else {
    writeFileSync(path, text);
  }
}
const names = new Set(engine.map((v) => v.name).concat(counter.map((v) => v.name)));
if (names.size !== engine.length + counter.length) throw new Error("duplicate vector names");
if (stale) process.exit(1);
console.log(`${engine.length} engine, ${counter.length} counter-evidence, ${mo.length} model-output, ${match.length} item-match vectors ${process.argv.includes("--check") ? "up to date" : "written"}.`);

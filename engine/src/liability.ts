// §8.2 liability matrix + agreed defaults (test-vectors/README.md).
// The claim photo's seal state is deliberately ignored: the customer always
// breaks the seal to open the bag.
import type { Confidence, EngineInput, Party, Policy, Split } from "@fairclaim/schemas";
import type { Evidence } from "./evidence.ts";

export type Liability =
  | { kind: "clear"; party: Party; liabilityCase: string }
  | { kind: "hold"; liabilityCase: string; lean: "restaurant" | "transit" | null; confidence: Confidence | null }
  | { kind: "undetermined"; liabilityCase: "undetermined" };

const hold = (liabilityCase: string, lean: "restaurant" | "transit" | null = null, confidence: Confidence | null = null): Liability => ({
  kind: "hold",
  liabilityCase,
  lean,
  confidence,
});
const clear = (party: Party, liabilityCase: string): Liability => ({ kind: "clear", party, liabilityCase });

export function assignLiability(input: EngineInput, ev: Evidence): Liability {
  const d = ev.dispatch;
  const h = ev.handoff;

  if (input.claim.issueType === "damaged") {
    // Handling question: the seal can't tell us anything about spills.
    if (!d) return hold("hold_no_dispatch");
    if (d.spill_or_damage_visible) return clear("restaurant", "restaurant_damage_at_dispatch");
    if (d.confidence !== "high") return hold("hold_damage_dispatch_uncertain", "transit", d.confidence);
    if (h) return clear(input.policy.handlingDamageLiable, "handling_damage");
    return hold("hold_damage_no_handoff", "transit", d.confidence);
  }

  // Missing / wrong item: tampering question, answered by dispatch seal vs handoff seal.
  // Sealed with the right code at dispatch and still intact at handoff → never packed.
  if (!d) {
    if (!h) return hold("hold_no_dispatch");
    return hold("hold_no_dispatch", h.seal_state === "intact" ? "restaurant" : "transit", h.confidence);
  }
  if (!h) return hold("hold_no_handoff");
  return h.seal_state === "intact" ? clear("restaurant", "restaurant_not_packed") : clear("transit", "transit_tamper");
}

/** Confidence-weighted split: base ± maxShift × weight / 1000 toward the party the evidence points at. */
export function holdSplit(l: Extract<Liability, { kind: "hold" }>, policy: Policy): Split {
  const { baseRestaurantPermille, maxShiftPermille, confidenceWeightPermille } = policy.holdSplit;
  let r = baseRestaurantPermille;
  if (l.lean !== null && l.confidence !== null) {
    const shift = Math.floor((maxShiftPermille * confidenceWeightPermille[l.confidence]) / 1000);
    r += l.lean === "restaurant" ? shift : -shift;
  }
  r = Math.min(1000, Math.max(0, r));
  return { restaurantPermille: r, transitPermille: 1000 - r };
}

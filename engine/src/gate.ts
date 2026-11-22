// §8.1 verification gate. App Check validity is enforced by Firebase itself
// (requests without a valid token never reach Firestore), so it isn't checked here.
import type { EngineInput, Order } from "@fairclaim/schemas";
import { namesMatch } from "./match.ts";

export function gateFailures(input: EngineInput): string[] {
  const { claim, order, policy } = input;
  const cc = claim.challengeCheck;
  const out: string[] = [];
  if (order.sealCode === null || cc.seal_code_read !== order.sealCode) out.push("gate_code_mismatch");
  if (cc.fingers_visible !== claim.challenge.fingers) out.push("gate_fingers_mismatch");
  const elapsed = claim.challenge.capturedAt - claim.challenge.issuedAt;
  if (elapsed < 0) out.push("gate_time_invalid");
  else if (elapsed > policy.challengeWindowSec * 1000) out.push("gate_window_expired");
  if (claim.moireScore >= policy.moireThreshold) out.push("gate_moire_high");
  if (cc.photo_of_screen_suspected) out.push("gate_screen_suspected");
  if (cc.confidence === "low") out.push("gate_challenge_low_confidence");
  if (claim.issueType !== "missing") {
    if (claim.damageCheck === null) out.push("gate_damage_check_missing");
    else if (claim.damageCheck.confidence === "low") out.push("gate_damage_low_confidence");
  }
  return out;
}

export function selectedItemsValid(input: EngineInput): boolean {
  const ids = input.claim.selectedItemIds;
  if (new Set(ids).size !== ids.length) return false;
  if (!ids.every((id) => input.order.items.some((i) => i.id === id))) return false;
  return input.claim.issueType === "missing" ? ids.length >= 1 : ids.length === 1;
}

const DAMAGE_ISSUES: ReadonlySet<string> = new Set(["spilled", "crushed", "foreign_object"]);

/** Crop result vs what the customer reported. Assumes selected items are valid. */
export function itemConsistency(input: EngineInput): string[] {
  const { claim, order } = input;
  const dc = claim.damageCheck;
  const selected = order.items.find((i) => i.id === claim.selectedItemIds[0]);
  if (dc === null || claim.issueType === "missing" || !selected) return [];
  const out: string[] = [];
  const matchesSelected = namesMatch(dc.matched_item, selected.name);
  if (claim.issueType === "damaged") {
    if (dc.issue === "none" || dc.severity === "none") out.push("damage_none_on_crop");
    else if (!DAMAGE_ISSUES.has(dc.issue)) out.push("damage_issue_mismatch");
    if (!matchesSelected && matchesOtherItem(dc.matched_item, order, selected.id)) out.push("damage_item_mismatch");
  } else if (matchesSelected) {
    out.push("wrong_item_disputed");
  }
  return out;
}

function matchesOtherItem(name: string, order: Order, exceptId: string): boolean {
  return order.items.some((i) => i.id !== exceptId && namesMatch(name, i.name));
}

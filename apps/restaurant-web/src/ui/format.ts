// Display helpers. Text from other clients/models is rendered as plain text only.
import { reasonCodes } from "@fairclaim/schemas";
import type { Verdict } from "@fairclaim/schemas";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const rupees = (n: number) => inr.format(n);

export const reasonText = (code: string): string => reasonCodes[code] ?? code.replaceAll("_", " ");

/** PLAN §22.3: model explanations are capped and never rendered as HTML. */
export const MAX_EXPLANATION_CHARS = 600;
export function capText(s: string, max = MAX_EXPLANATION_CHARS): string {
  const chars = Array.from(s.trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  auto_refund: "Refunded instantly",
  hold: "On hold",
  review: "Under review",
};

const CASE_LABEL: Record<string, string> = {
  handling_damage: "Packed clean and sealed; damaged in transit",
  restaurant_damage_at_dispatch: "Damage was already visible in the dispatch photo",
  transit_tamper: "Sealed at dispatch, but the seal was broken before delivery",
  restaurant_not_packed: "Sealed at dispatch and still sealed at handoff, so it was never packed",
  hold_no_dispatch: "No dispatch photo, so responsibility is split",
  hold_no_handoff: "No handoff snap, so responsibility is split",
  hold_damage_no_handoff: "Clean dispatch but no handoff snap",
  hold_damage_dispatch_uncertain: "Dispatch photo wasn't clear enough to rule out damage",
  undetermined: "Responsibility couldn't be determined",
};
export const caseText = (c: string) => CASE_LABEL[c] ?? c.replaceAll("_", " ");

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(-6).toUpperCase() : id.toUpperCase();
}

const time = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const when = (ms: number | null) => (ms === null ? "just now" : time.format(ms));

export const ISSUE_LABEL = { damaged: "Damaged or spilled", missing: "Missing item", wrong_item: "Wrong item" } as const;

export const OUTCOME_LABEL = { refunded: "Refunded", pending: "On hold", review: "Under review" } as const;

/** Short labels for the anti-fraud gate failures (full text: reason-codes.json). */
export const SIGNAL_LABEL: Record<string, string> = {
  gate_code_mismatch: "Wrong seal code",
  gate_moire_high: "Photo of a screen",
  gate_screen_suspected: "Screen suspected",
  gate_fingers_mismatch: "Finger check failed",
  gate_window_expired: "Photo too late",
  gate_time_invalid: "Photo time invalid",
};

/** Customers are anonymous by design: a short, stable pseudonym from the Firebase uid. */
export const customerLabel = (uid: string) => `Customer ${uid.slice(-6).toUpperCase()}`;

const pct = new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 0 });
export const percent = (part: number, whole: number) => (whole === 0 ? "–" : pct.format(part / whole));

const FIELD_LABEL: Record<string, string> = {
  verdict: "the verdict",
  refundAmount: "the refund amount",
  "liability.restaurant": "the restaurant's share",
  "liability.transit": "the delivery share",
  "liability.platform": "the platform share",
  reasons: "the reasons",
  cropSha256: "the damage photo (it was changed after the check)",
};
/** Audit mismatch fields in words ("unreadable:<doc>" stays as is). */
export function mismatchText(fields: readonly string[]): string {
  const parts = fields.map((f) => FIELD_LABEL[f] ?? f);
  return parts.length <= 1 ? (parts[0] ?? "the decision") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

const compact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 });
/** ₹1.2K, ₹45K: for big standalone figures where every rupee isn't the point. */
export const rupeesCompact = (n: number) => (Math.abs(n) < 10_000 ? rupees(n) : compact.format(n));

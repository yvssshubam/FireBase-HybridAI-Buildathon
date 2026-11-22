// Replay-audit comparison (PLAN §22.2): the restaurant re-runs the TS engine on the
// stored evidence and compares the result with the decision the customer's app wrote.
import type { EngineDecision } from "@fairclaim/schemas";

export interface AuditOutcome {
  match: boolean;
  mismatchFields: string[];
  cropHashMatch: boolean | null;
}

// audits/{id}.mismatchFields is capped at 20 entries by the rules.
const MAX_FIELDS = 20;

/** Fields that must agree: verdict, refund, each liability share, and the reason codes (in order). */
export function compareDecisions(stored: EngineDecision, replay: EngineDecision): string[] {
  const out: string[] = [];
  if (stored.verdict !== replay.verdict) out.push("verdict");
  if (stored.refundAmount !== replay.refundAmount) out.push("refundAmount");
  for (const party of ["restaurant", "transit", "platform"] as const) {
    if (stored.liability[party] !== replay.liability[party]) out.push(`liability.${party}`);
  }
  const sameReasons = stored.reasons.length === replay.reasons.length && stored.reasons.every((r, i) => r === replay.reasons[i]);
  if (!sameReasons) out.push("reasons");
  return out;
}

/**
 * `cropHashMatch`: true/false when a crop was compared, null when the claim has no crop
 * (missing-item claims) or the crop has expired under the 3-day retention policy.
 */
export function auditOutcome(fields: readonly string[], cropHashMatch: boolean | null): AuditOutcome {
  const all = [...fields, ...(cropHashMatch === false ? ["cropSha256"] : [])];
  return { match: all.length === 0, mismatchFields: all.slice(0, MAX_FIELDS), cropHashMatch };
}

/** A document the audit needs could not be read or failed validation → that is itself a mismatch. */
export function unreadableOutcome(what: string): AuditOutcome {
  return { match: false, mismatchFields: [`unreadable:${what}`.slice(0, 120)], cropHashMatch: null };
}

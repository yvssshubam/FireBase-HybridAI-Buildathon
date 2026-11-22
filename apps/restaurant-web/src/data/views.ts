// Decisions view model: which tab a claim belongs in, and why.
import type { AuditDoc, DecisionDoc, HoldDoc, ResolutionDoc } from "./docs.ts";

export type Tab = "auto" | "hold" | "review";

export interface DecisionView {
  decision: DecisionDoc;
  hold: HoldDoc | null;
  resolution: ResolutionDoc | null;
  audit: AuditDoc | null;
  tab: Tab;
  /** Why it is in Needs review (empty otherwise). */
  reviewBecause: ("review_verdict" | "escalated" | "audit_mismatch")[];
}

export function classify(
  decision: DecisionDoc,
  hold: HoldDoc | null,
  resolution: ResolutionDoc | null,
  audit: AuditDoc | null,
): DecisionView {
  const because: DecisionView["reviewBecause"] = [];
  if (decision.verdict === "review") because.push("review_verdict");
  if (resolution?.outcome === "review" || hold?.state === "escalated") because.push("escalated");
  if (audit?.match === false) because.push("audit_mismatch");
  const tab: Tab = because.length > 0 ? "review" : decision.verdict === "hold" ? "hold" : "auto";
  return { decision, hold, resolution, audit, tab, reviewBecause: because };
}

export function buildViews(
  decisions: ReadonlyMap<string, DecisionDoc>,
  holds: ReadonlyMap<string, HoldDoc>,
  resolutions: ReadonlyMap<string, ResolutionDoc>,
  audits: ReadonlyMap<string, AuditDoc>,
): DecisionView[] {
  return [...decisions.entries()]
    .map(([id, d]) => classify(d, holds.get(id) ?? null, resolutions.get(id) ?? null, audits.get(id) ?? null))
    .sort((a, b) => (b.decision.createdAt ?? 0) - (a.decision.createdAt ?? 0));
}

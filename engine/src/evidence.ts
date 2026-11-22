// Classifies dispatch / handoff evidence and item presence at dispatch.
import type { DispatchCheck, EngineInput, HandoffCheck, Order } from "@fairclaim/schemas";
import { namesMatch } from "./match.ts";

export type DispatchFact = "dispatch_valid" | "dispatch_missing" | "dispatch_invalid";
export type HandoffFact = "handoff_intact" | "handoff_broken" | "handoff_missing" | "handoff_unusable";
export type ItemStatus = "visible" | "absent" | "unclear";

export interface Evidence {
  dispatchFact: DispatchFact;
  /** Only set when the dispatch photo is usable (default 4). */
  dispatch: DispatchCheck | null;
  handoffFact: HandoffFact;
  /** Only set when the handoff snap is usable (default 2). */
  handoff: HandoffCheck | null;
}

export function classifyEvidence(input: EngineInput): Evidence {
  const { order } = input;
  const d = input.dispatch?.check ?? null;
  const h = input.handoff?.check ?? null;

  let dispatchFact: DispatchFact = "dispatch_missing";
  let dispatch: DispatchCheck | null = null;
  if (d) {
    const valid = d.seal_intact && order.sealCode !== null && d.seal_code_read === order.sealCode;
    dispatchFact = valid ? "dispatch_valid" : "dispatch_invalid";
    dispatch = valid ? d : null;
  }

  let handoffFact: HandoffFact = "handoff_missing";
  let handoff: HandoffCheck | null = null;
  if (h) {
    const usable = order.sealCode !== null && h.seal_code_read === order.sealCode && h.seal_state !== "not_visible";
    handoffFact = !usable ? "handoff_unusable" : h.seal_state === "intact" ? "handoff_intact" : "handoff_broken";
    handoff = usable ? h : null;
  }
  return { dispatchFact, dispatch, handoffFact, handoff };
}

/** Per selected item: matched by name → visible; not matched and count short → absent; else unclear. */
export function itemStatuses(check: DispatchCheck, order: Order, selectedIds: readonly string[]): ItemStatus[] {
  const countShort = check.visible_item_count < order.items.length;
  return selectedIds.map((id) => {
    const item = order.items.find((i) => i.id === id);
    if (!item) return "unclear";
    if (check.visible_items.some((v) => namesMatch(v, item.name))) return "visible";
    return countShort ? "absent" : "unclear";
  });
}

/** All the same → that status; mixed → unclear. */
export function aggregateStatus(statuses: readonly ItemStatus[]): ItemStatus {
  const first = statuses[0];
  if (first === undefined) return "unclear";
  return statuses.every((s) => s === first) ? first : "unclear";
}

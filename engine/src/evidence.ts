// Classifies dispatch / handoff evidence. A sealed bag hides the food, so item
// presence is never read from the dispatch photo: the seal answers tampering.
import type { DispatchCheck, EngineInput, HandoffCheck } from "@fairclaim/schemas";

export type DispatchFact = "dispatch_valid" | "dispatch_missing" | "dispatch_invalid";
export type HandoffFact = "handoff_intact" | "handoff_broken" | "handoff_missing" | "handoff_unusable";

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

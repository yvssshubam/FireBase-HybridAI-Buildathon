// What the restaurant sees after DispatchCheck. Acceptance mirrors firestore.rules
// (dispatch/{orderId}: intact seal AND the right code), plus: a photo the model itself
// rates low-confidence is retaken rather than recorded (Decision 3: bad dispatch photo
// rejected at capture; on-device tests showed confident-sounding guesses on empty photos).
// Seal-only: a sealed parcel hides the food, so items are never assessed here.
import type { DispatchCheck } from "@fairclaim/schemas";

export interface DispatchAssessment {
  accept: boolean;
  problems: string[];
  /** Recorded as-is, but a damage claim on this order would then go against the restaurant. */
  damageVisible: boolean;
}

export function assessDispatch(check: DispatchCheck, sealCode: string): DispatchAssessment {
  const problems: string[] = [];
  if (!check.seal_intact) problems.push("The seal sticker isn't visible as intact.");
  if (check.seal_code_read === "") problems.push(`The seal code couldn't be read. Make sure ${sealCode} is large and in focus.`);
  else if (check.seal_code_read !== sealCode) problems.push(`The photo shows code ${check.seal_code_read}, but this order's code is ${sealCode}.`);
  if (check.confidence === "low") problems.push("The photo is too unclear to rely on. Use more light and fill the frame with the sealed parcel.");
  return { accept: problems.length === 0, problems, damageVisible: check.spill_or_damage_visible };
}

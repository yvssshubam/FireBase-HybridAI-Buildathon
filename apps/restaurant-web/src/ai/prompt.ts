// Prompt for DispatchCheck (dispatch photo and Flow E counter-evidence photo).
// Single-turn, English (on-device language support), image + text in → JSON out.
//
// Seal-only: a sealed bag hides the food, so the model is never asked about items
// (on-device tests showed it "seeing" whatever items it was told to expect).
// The prompt holds no restaurant-typed text and no expected seal code: the model
// must read the code from the photo, not echo what we hoped to see.

export type CheckPurpose = "dispatch" | "counter";

const INTRO: Record<CheckPurpose, string> = {
  dispatch: "You check a photo of a sealed food-delivery parcel at the restaurant counter, just before it leaves.",
  counter: "You check a photo a restaurant took to show how a disputed food-delivery parcel was sealed.",
};

export function buildDispatchPrompt(purpose: CheckPurpose): string {
  return [
    INTRO[purpose],
    "Report only what is actually visible in the photo. Do not guess.",
    "Ignore people, faces, hands, screens, and any text other than the seal sticker.",
    "The parcel should be closed with a seal sticker showing a handwritten or printed 4-digit code.",
    "Fields:",
    "- seal_intact: true only if you can clearly see a seal sticker that closes the parcel and is unbroken. If there is no sticker, or you are unsure, false.",
    '- seal_code_read: the 4 digits written on that seal sticker, exactly as they appear. If there is no sticker or you cannot read all 4 digits, "".',
    "- spill_or_damage_visible: true if a spill, leak, tear or crushed packaging is visible on the outside of the parcel.",
    "- confidence: high, medium or low, for how sure you are about the seal and the code. low if the photo is dark, blurry, or shows no seal sticker.",
    "Respond with JSON only.",
  ].join("\n");
}

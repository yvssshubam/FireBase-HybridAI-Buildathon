// DispatchCheck response schema for both inference paths: `responseSchema` (cloud)
// and `responseConstraint` (Chrome on-device). Mirrors
// packages/schemas/schemas/dispatch-check.schema.json; parseModelOutput() still
// normalizes and validates whatever comes back.
import { Schema } from "firebase/ai";

export const dispatchCheckSchema = Schema.object({
  properties: {
    seal_intact: Schema.boolean(),
    seal_code_read: Schema.string({ description: 'Exactly 4 digits, or "" if not readable' }),
    spill_or_damage_visible: Schema.boolean(),
    confidence: Schema.enumString({ enum: ["high", "medium", "low"] }),
  },
});

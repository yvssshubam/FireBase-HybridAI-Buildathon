import policyJson from "../policy/policy.v1.json" with { type: "json" };
import reasonCodesJson from "../reason-codes.json" with { type: "json" };
import { validatePolicy } from "./generated/validators.js";
import type { Policy } from "./types.ts";

export * from "./types.ts";
export * from "./modelOutput.ts";
export {
  validateChallengeCheck,
  validateClaimEvidence,
  validateDamageCheck,
  validateDispatchCheck,
  validateEngineDecision,
  validateHandoffCheck,
  validatePolicy,
  validateReview,
} from "./generated/validators.js";
export type { Validator, ValidationError } from "./generated/validators.js";

/** Parses and validates a policy (e.g. the Remote Config `policy_json` string). */
export function parsePolicy(json: unknown): Policy {
  const value: unknown = typeof json === "string" ? JSON.parse(json) : json;
  if (!validatePolicy(value)) {
    throw new Error(`invalid policy: ${JSON.stringify(validatePolicy.errors?.[0] ?? null)}`);
  }
  return value as Policy;
}

/** Bundled default, used until Remote Config has been fetched. */
export const defaultPolicy: Policy = parsePolicy(policyJson);

export const reasonCodes: Readonly<Record<string, string>> = reasonCodesJson;

// Types for the generated ajv standalone validators.
export interface ValidationError {
  instancePath: string;
  message?: string;
}
export interface Validator {
  (data: unknown): boolean;
  errors?: ValidationError[] | null;
}
export const validateDispatchCheck: Validator;
export const validateHandoffCheck: Validator;
export const validateChallengeCheck: Validator;
export const validateDamageCheck: Validator;
export const validateReview: Validator;
export const validatePolicy: Validator;
export const validateClaimEvidence: Validator;
export const validateEngineDecision: Validator;

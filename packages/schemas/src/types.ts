// Shared domain types. JSON Schemas in ../schemas are the source of truth for
// wire formats; these types mirror them and the vectors keep both honest.

export type Confidence = "high" | "medium" | "low";
export type InferenceSource = "ON_DEVICE" | "IN_CLOUD";
export type SealState = "intact" | "broken" | "not_visible";
export type DamageIssue = "spilled" | "crushed" | "missing" | "wrong_item" | "foreign_object" | "none";
export type Severity = "none" | "minor" | "partial" | "total";
export type IssueType = "damaged" | "missing" | "wrong_item";
export type Party = "restaurant" | "transit" | "platform";
export type Verdict = "auto_refund" | "hold" | "review";

export const REVIEW_FLAGS = [
  "claimed_item_not_in_order",
  "issue_type_inconsistent",
  "dispatch_contradiction",
  "handoff_contradiction",
  "timeline_inconsistent",
  "other",
] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

export interface DispatchCheck {
  seal_intact: boolean;
  seal_code_read: string;
  visible_item_count: number;
  visible_items: string[];
  spill_or_damage_visible: boolean;
  confidence: Confidence;
}

export interface HandoffCheck {
  seal_state: SealState;
  seal_code_read: string;
  confidence: Confidence;
}

export interface ChallengeCheck {
  seal_code_read: string;
  fingers_visible: number;
  seal_state: SealState;
  photo_of_screen_suspected: boolean;
  confidence: Confidence;
}

export interface DamageCheck {
  matched_item: string;
  issue: DamageIssue;
  severity: Severity;
  confidence: Confidence;
}

export interface ReviewOutput {
  consistent: boolean;
  flags: ReviewFlag[];
  explanation_customer_en: string;
  explanation_customer_hi: string;
  explanation_customer_ta: string;
  explanation_restaurant: string;
}

export interface ModelOutputs {
  dispatch: DispatchCheck;
  handoff: HandoffCheck;
  challenge: ChallengeCheck;
  damage: DamageCheck;
  review: ReviewOutput;
}
export type ModelOutputKind = keyof ModelOutputs;

export interface Challenge {
  kind: "fingers";
  code: string;
  fingers: number;
  issuedAt: number;
  capturedAt: number;
  expiresAt: number;
}

export interface ClaimEvidence {
  claimId: string;
  orderId: string;
  customerId: string;
  issueType: IssueType;
  selectedItemIds: string[];
  challenge: Challenge;
  challengeCheck: ChallengeCheck;
  damageCheck: DamageCheck | null;
  moireScore: number;
  cropSha256: string | null;
  cropRef: string | null;
  inferenceSources: { challenge: InferenceSource; damage: InferenceSource | null };
  customerClaims30d: number;
}

export interface OrderItem {
  id: string;
  name: string;
  price: number;
}

export interface Order {
  id: string;
  items: OrderItem[];
  total: number;
  sealCode: string | null;
}

export interface Policy {
  policyVersion: string;
  currency: "INR";
  autoApproveCap: number;
  claimHistoryLimit30d: number;
  challengeWindowSec: number;
  moireThreshold: number;
  severityPermille: { minor: number; partial: number; total: number; missing: number; wrong_item: number };
  handlingDamageLiable: Party;
  holdHours: number;
  holdSplit: {
    baseRestaurantPermille: number;
    maxShiftPermille: number;
    confidenceWeightPermille: Record<Confidence, number>;
  };
  counterEvidence: { restaurantPermilleAfterClear: number };
}

export type ReviewInput =
  | { status: "ok"; consistent: boolean; flags: string[] }
  | { status: "unavailable" };

export type EngineClaim = Pick<
  ClaimEvidence,
  "issueType" | "selectedItemIds" | "challenge" | "challengeCheck" | "damageCheck" | "moireScore" | "customerClaims30d"
>;

export interface EngineInput {
  order: Order;
  dispatch: { check: DispatchCheck } | null;
  handoff: { check: HandoffCheck } | null;
  claim: EngineClaim;
  // null = preliminary decision before the cloud review has run.
  review: ReviewInput | null;
  policy: Policy;
}

export interface Liability {
  restaurant: number;
  transit: number;
  platform: number;
}

export interface Split {
  restaurantPermille: number;
  transitPermille: number;
}

export interface EngineDecision {
  verdict: Verdict;
  refundAmount: number;
  assessedAmount: number;
  currency: "INR";
  liability: Liability;
  liabilityCase: string;
  split: Split | null;
  reasons: string[];
  holdHours: number | null;
  policyVersion: string;
}

export interface Resolution {
  outcome: "settled" | "review";
  refundAmount: number;
  liability: Liability;
  reasons: string[];
  policyVersion: string;
}

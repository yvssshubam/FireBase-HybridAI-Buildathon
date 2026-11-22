// Firestore document shapes (as written under firestore.rules) and their parsers.
import {
  validateChallengeCheck,
  validateDamageCheck,
  validateDispatchCheck,
  validateHandoffCheck,
  type ChallengeCheck,
  type ClaimEvidence,
  type DamageCheck,
  type DispatchCheck,
  type HandoffCheck,
  type InferenceSource,
  type IssueType,
  type Liability,
  type OrderItem,
  type ReviewInput,
  type Split,
  type Validator,
  type Verdict,
} from "@fairclaim/schemas";
import { asObj, bool, DocError, int, intOrNull, millisOrNull, num, oneOf, str, strList, strOrNull, type Obj } from "./read.ts";

export const INFERENCE_SOURCES = ["ON_DEVICE", "IN_CLOUD"] as const;
export const ORDER_STATUSES = ["placed", "dispatched", "delivered"] as const;
export const HOLD_STATES = ["held", "accepted", "resolved", "escalated", "settled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type HoldState = (typeof HOLD_STATES)[number];

export interface MenuItem {
  name: string;
  price: number;
}

export interface RestaurantDoc {
  id: string;
  name: string;
  pairCode: string;
  menu: Record<string, MenuItem>;
}

export interface OrderDoc {
  id: string;
  restaurantId: string;
  customerId: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  sealCode: string | null;
  createdAt: number | null;
  dispatchedAt: number | null;
  deliveredAt: number | null;
}

export interface DispatchDoc {
  orderId: string;
  check: DispatchCheck;
  inferenceSource: InferenceSource;
  imageSha256: string;
  thumbRef: string | null;
  capturedAt: number;
}

export interface HandoffDoc {
  orderId: string;
  check: HandoffCheck;
  inferenceSource: InferenceSource;
  capturedAt: number;
}

export interface ClaimDoc extends ClaimEvidence {
  createdAt: number | null;
}

export interface DecisionDoc {
  claimId: string;
  orderId: string;
  customerId: string;
  restaurantId: string;
  verdict: Verdict;
  refundAmount: number;
  assessedAmount: number;
  currency: "INR";
  liability: Liability;
  liabilityCase: string;
  split: Split | null;
  reasons: string[];
  holdHours: number | null;
  review: ReviewInput;
  explanationRestaurant: string;
  engine: "kotlin" | "ts";
  policyVersion: string;
  createdAt: number | null;
}

export interface HoldDoc {
  claimId: string;
  customerId: string;
  restaurantId: string;
  amount: number;
  parties: Liability;
  state: HoldState;
  holdHours: number;
  createdAt: number | null;
  resolvedAt: number | null;
}

export interface ResolutionDoc {
  claimId: string;
  outcome: "settled" | "review";
  refundAmount: number;
  liability: Liability;
  reasons: string[];
  policyVersion: string;
  createdAt: number | null;
}

export interface AuditDoc {
  claimId: string;
  match: boolean;
  mismatchFields: string[];
  cropHashMatch: boolean | null;
  policyVersion: string;
  auditedAt: number | null;
}

export interface CounterEvidenceDoc {
  claimId: string;
  check: DispatchCheck;
  inferenceSource: InferenceSource;
  imageSha256: string;
  photoRef: string;
}

function checked<T>(validate: Validator, v: unknown, path: string): T {
  if (!validate(v)) throw new DocError(path, `invalid model output (${validate.errors?.[0]?.message ?? "schema"})`);
  return v as T;
}

function liability(o: Obj, key: string, path: string): Liability {
  const m = asObj(o[key], `${path}.${key}`);
  const p = `${path}.${key}`;
  return { restaurant: int(m, "restaurant", p), transit: int(m, "transit", p), platform: int(m, "platform", p) };
}

export function parseRestaurant(id: string, data: unknown): RestaurantDoc {
  const p = `restaurants/${id}`;
  const o = asObj(data, p);
  const menuObj = asObj(o.menu, `${p}.menu`);
  const menu: Record<string, MenuItem> = {};
  for (const [itemId, raw] of Object.entries(menuObj)) {
    const m = asObj(raw, `${p}.menu.${itemId}`);
    menu[itemId] = { name: str(m, "name", `${p}.menu.${itemId}`), price: int(m, "price", `${p}.menu.${itemId}`) };
  }
  return { id, name: str(o, "name", p), pairCode: str(o, "pairCode", p), menu };
}

export function parseOrder(id: string, data: unknown): OrderDoc {
  const p = `orders/${id}`;
  const o = asObj(data, p);
  if (!Array.isArray(o.items)) throw new DocError(`${p}.items`, "expected a list");
  const items = o.items.map((raw, i) => {
    const it = asObj(raw, `${p}.items[${i}]`);
    return { id: str(it, "id", `${p}.items[${i}]`), name: str(it, "name", `${p}.items[${i}]`), price: int(it, "price", `${p}.items[${i}]`) };
  });
  return {
    id,
    restaurantId: str(o, "restaurantId", p),
    customerId: str(o, "customerId", p),
    items,
    total: int(o, "total", p),
    status: oneOf(o, "status", ORDER_STATUSES, p),
    sealCode: strOrNull(o, "sealCode", p),
    createdAt: millisOrNull(o, "createdAt", p),
    dispatchedAt: millisOrNull(o, "dispatchedAt", p),
    deliveredAt: millisOrNull(o, "deliveredAt", p),
  };
}

export function parseDispatch(orderId: string, data: unknown): DispatchDoc {
  const p = `dispatch/${orderId}`;
  const o = asObj(data, p);
  return {
    orderId,
    check: checked<DispatchCheck>(validateDispatchCheck, o.check, `${p}.check`),
    inferenceSource: oneOf(o, "inferenceSource", INFERENCE_SOURCES, p),
    imageSha256: str(o, "imageSha256", p),
    thumbRef: strOrNull(o, "thumbRef", p),
    capturedAt: int(o, "capturedAt", p),
  };
}

export function parseHandoff(orderId: string, data: unknown): HandoffDoc {
  const p = `handoff/${orderId}`;
  const o = asObj(data, p);
  return {
    orderId,
    check: checked<HandoffCheck>(validateHandoffCheck, o.check, `${p}.check`),
    inferenceSource: oneOf(o, "inferenceSource", INFERENCE_SOURCES, p),
    capturedAt: int(o, "capturedAt", p),
  };
}

export function parseClaim(id: string, data: unknown): ClaimDoc {
  const p = `claims/${id}`;
  const o = asObj(data, p);
  const ch = asObj(o.challenge, `${p}.challenge`);
  const cp = `${p}.challenge`;
  const src = asObj(o.inferenceSources, `${p}.inferenceSources`);
  const sp = `${p}.inferenceSources`;
  return {
    claimId: str(o, "claimId", p),
    orderId: str(o, "orderId", p),
    customerId: str(o, "customerId", p),
    issueType: oneOf<IssueType>(o, "issueType", ["damaged", "missing", "wrong_item"], p),
    selectedItemIds: strList(o, "selectedItemIds", p),
    challenge: {
      kind: oneOf(ch, "kind", ["fingers"], cp),
      code: str(ch, "code", cp),
      fingers: int(ch, "fingers", cp),
      issuedAt: int(ch, "issuedAt", cp),
      capturedAt: int(ch, "capturedAt", cp),
      expiresAt: int(ch, "expiresAt", cp),
    },
    challengeCheck: checked<ChallengeCheck>(validateChallengeCheck, o.challengeCheck, `${p}.challengeCheck`),
    damageCheck: o.damageCheck === null || o.damageCheck === undefined ? null : checked<DamageCheck>(validateDamageCheck, o.damageCheck, `${p}.damageCheck`),
    moireScore: num(o, "moireScore", p),
    cropSha256: strOrNull(o, "cropSha256", p),
    cropRef: strOrNull(o, "cropRef", p),
    inferenceSources: {
      challenge: oneOf(src, "challenge", INFERENCE_SOURCES, sp),
      damage: src.damage === null || src.damage === undefined ? null : oneOf(src, "damage", INFERENCE_SOURCES, sp),
    },
    customerClaims30d: int(o, "customerClaims30d", p),
    createdAt: millisOrNull(o, "createdAt", p),
  };
}

function parseReview(v: unknown, path: string): ReviewInput {
  const o = asObj(v, path);
  const status = oneOf(o, "status", ["ok", "unavailable"], path);
  if (status === "unavailable") return { status };
  return { status, consistent: bool(o, "consistent", path), flags: strList(o, "flags", path) };
}

export function parseDecision(id: string, data: unknown): DecisionDoc {
  const p = `decisions/${id}`;
  const o = asObj(data, p);
  const split =
    o.split === null || o.split === undefined
      ? null
      : (() => {
          const s = asObj(o.split, `${p}.split`);
          return { restaurantPermille: int(s, "restaurantPermille", `${p}.split`), transitPermille: int(s, "transitPermille", `${p}.split`) };
        })();
  const ex = asObj(o.explanations, `${p}.explanations`);
  return {
    claimId: str(o, "claimId", p),
    orderId: str(o, "orderId", p),
    customerId: str(o, "customerId", p),
    restaurantId: str(o, "restaurantId", p),
    verdict: oneOf<Verdict>(o, "verdict", ["auto_refund", "hold", "review"], p),
    refundAmount: int(o, "refundAmount", p),
    assessedAmount: int(o, "assessedAmount", p),
    currency: oneOf(o, "currency", ["INR"], p),
    liability: liability(o, "liability", p),
    liabilityCase: str(o, "liabilityCase", p),
    split,
    reasons: strList(o, "reasons", p),
    holdHours: intOrNull(o, "holdHours", p),
    review: parseReview(o.review, `${p}.review`),
    explanationRestaurant: str(ex, "restaurant", `${p}.explanations`),
    engine: oneOf(o, "engine", ["kotlin", "ts"], p),
    policyVersion: str(o, "policyVersion", p),
    createdAt: millisOrNull(o, "createdAt", p),
  };
}

export function parseHold(id: string, data: unknown): HoldDoc {
  const p = `holds/${id}`;
  const o = asObj(data, p);
  return {
    claimId: str(o, "claimId", p),
    customerId: str(o, "customerId", p),
    restaurantId: str(o, "restaurantId", p),
    amount: int(o, "amount", p),
    parties: liability(o, "parties", p),
    state: oneOf(o, "state", HOLD_STATES, p),
    holdHours: int(o, "holdHours", p),
    createdAt: millisOrNull(o, "createdAt", p),
    resolvedAt: millisOrNull(o, "resolvedAt", p),
  };
}

export function parseResolution(id: string, data: unknown): ResolutionDoc {
  const p = `resolutions/${id}`;
  const o = asObj(data, p);
  return {
    claimId: str(o, "claimId", p),
    outcome: oneOf(o, "outcome", ["settled", "review"], p),
    refundAmount: int(o, "refundAmount", p),
    liability: liability(o, "liability", p),
    reasons: strList(o, "reasons", p),
    policyVersion: str(o, "policyVersion", p),
    createdAt: millisOrNull(o, "createdAt", p),
  };
}

export function parseAudit(id: string, data: unknown): AuditDoc {
  const p = `audits/${id}`;
  const o = asObj(data, p);
  return {
    claimId: str(o, "claimId", p),
    match: bool(o, "match", p),
    mismatchFields: strList(o, "mismatchFields", p),
    cropHashMatch: o.cropHashMatch === null || o.cropHashMatch === undefined ? null : bool(o, "cropHashMatch", p),
    policyVersion: str(o, "policyVersion", p),
    auditedAt: millisOrNull(o, "auditedAt", p),
  };
}

export function parseCounterEvidence(id: string, data: unknown): CounterEvidenceDoc {
  const p = `counterEvidence/${id}`;
  const o = asObj(data, p);
  return {
    claimId: str(o, "claimId", p),
    check: checked<DispatchCheck>(validateDispatchCheck, o.check, `${p}.check`),
    inferenceSource: oneOf(o, "inferenceSource", INFERENCE_SOURCES, p),
    imageSha256: str(o, "imageSha256", p),
    photoRef: str(o, "photoRef", p),
  };
}


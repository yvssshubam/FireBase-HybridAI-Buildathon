// Turns raw model text into a validated, normalized check object.
// Mirrored in Kotlin (ModelOutputs.kt); test-vectors/model-output.vectors.json
// pins both to identical results.
import { REVIEW_FLAGS, type ModelOutputKind, type ModelOutputs } from "./types.ts";
import {
  validateChallengeCheck,
  validateDamageCheck,
  validateDispatchCheck,
  validateHandoffCheck,
  validateReview,
  type Validator,
} from "./generated/validators.js";

export type ParseError = "no_json" | "bad_json" | "schema";
export type ParseResult<K extends ModelOutputKind> =
  | { ok: true; value: ModelOutputs[K] }
  | { ok: false; error: ParseError; detail?: string };

type Field = "code" | "enum" | "text60" | "text600" | "flags" | "raw";

const FIELDS: Record<ModelOutputKind, Record<string, Field>> = {
  dispatch: {
    seal_intact: "raw",
    seal_code_read: "code",
    spill_or_damage_visible: "raw",
    confidence: "enum",
  },
  handoff: { seal_state: "enum", seal_code_read: "code", confidence: "enum" },
  challenge: {
    seal_code_read: "code",
    fingers_visible: "raw",
    seal_state: "enum",
    photo_of_screen_suspected: "raw",
    confidence: "enum",
  },
  damage: { matched_item: "text60", issue: "enum", severity: "enum", confidence: "enum" },
  review: {
    consistent: "raw",
    flags: "flags",
    explanation_customer_en: "text600",
    explanation_customer_hi: "text600",
    explanation_customer_ta: "text600",
    explanation_restaurant: "text600",
  },
};

const VALIDATORS: Record<ModelOutputKind, Validator> = {
  dispatch: validateDispatchCheck,
  handoff: validateHandoffCheck,
  challenge: validateChallengeCheck,
  damage: validateDamageCheck,
  review: validateReview,
};

const KNOWN_FLAGS: ReadonlySet<string> = new Set(REVIEW_FLAGS);

/** Model may wrap JSON in prose or ``` fences; take the outermost {...}. */
export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

/** Digits only; anything other than exactly four digits means "not readable". */
export function normalizeSealCode(raw: unknown): unknown {
  let s: string;
  if (typeof raw === "string") s = raw;
  else if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) s = String(raw);
  else return raw;
  const digits = s.replace(/[^0-9]/g, "");
  return digits.length === 4 ? digits : "";
}

function normalizeField(kind: Field, v: unknown): unknown {
  switch (kind) {
    case "raw":
      return v;
    case "code":
      return normalizeSealCode(v);
    case "enum":
      return typeof v === "string" ? v.trim().toLowerCase() : v;
    case "text60":
      return typeof v === "string" ? v.trim().slice(0, 60) : v;
    case "text600":
      return typeof v === "string" ? v.trim().slice(0, 600) : v;
    case "flags": {
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return v;
      const out: string[] = [];
      for (const x of v as string[]) {
        const f = x.trim().toLowerCase();
        const mapped = KNOWN_FLAGS.has(f) ? f : "other";
        if (!out.includes(mapped)) out.push(mapped);
      }
      return out.slice(0, 6);
    }
  }
}

export function parseModelOutput<K extends ModelOutputKind>(kind: K, text: string): ParseResult<K> {
  const json = extractJson(text);
  if (json === null) return { ok: false, error: "no_json" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "bad_json" };
  }
  // extractJson always yields "{...}", so a successful parse is a plain object.
  const src = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(FIELDS[kind])) {
    if (Object.hasOwn(src, key)) out[key] = normalizeField(field, src[key]);
  }
  const validate = VALIDATORS[kind];
  if (!validate(out)) {
    const e = validate.errors?.[0];
    return { ok: false, error: "schema", detail: `${e?.instancePath ?? ""} ${e?.message ?? ""}`.trim() };
  }
  return { ok: true, value: out as unknown as ModelOutputs[K] };
}

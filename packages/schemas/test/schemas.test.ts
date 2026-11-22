import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultPolicy,
  parseModelOutput,
  parsePolicy,
  reasonCodes,
  validateClaimEvidence,
  validatePolicy,
  type ModelOutputKind,
} from "../src/index.ts";

const dir = join(import.meta.dirname, "..", "test-vectors");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(dir, name), "utf8")) as T;

describe("model output parsing — shared vectors", () => {
  const vectors = load<{ name: string; kind: ModelOutputKind; text: string; expected: { ok: boolean; value?: unknown; error?: string } }[]>(
    "model-output.vectors.json",
  );
  it.each(vectors.map((v) => [`${v.kind}: ${v.name}`, v] as const))("%s", (_, v) => {
    const r = parseModelOutput(v.kind, v.text);
    if (v.expected.ok) {
      expect(r).toEqual({ ok: true, value: v.expected.value });
    } else {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(v.expected.error);
    }
  });
});

describe("policy", () => {
  it("bundled default is valid", () => {
    expect(validatePolicy(defaultPolicy)).toBe(true);
  });
  it("parses the Remote Config template value", () => {
    const tpl = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "remoteconfig.template.json"), "utf8"));
    expect(parsePolicy(tpl.parameters.policy_json.defaultValue.value)).toEqual(defaultPolicy);
    expect(tpl.parameters.policy_version.defaultValue.value).toBe(defaultPolicy.policyVersion);
  });
  it("rejects a factor above 100%", () => {
    expect(() => parsePolicy({ ...defaultPolicy, severityPermille: { ...defaultPolicy.severityPermille, total: 1001 } })).toThrow();
  });
});

describe("reason codes", () => {
  it("every code the vectors use has display text", () => {
    const used = new Set<string>();
    for (const v of load<{ expected: { reasons?: string[] } }[]>("engine.vectors.json")) v.expected.reasons?.forEach((r) => used.add(r));
    for (const v of load<{ expected: { reasons?: string[] } }[]>("counter-evidence.vectors.json")) v.expected.reasons?.forEach((r) => used.add(r));
    expect([...used].filter((c) => !(c in reasonCodes))).toEqual([]);
  });
});

describe("claim evidence schema", () => {
  const claim = {
    claimId: "c1",
    orderId: "order-1",
    customerId: "uid-1",
    issueType: "damaged",
    selectedItemIds: ["gulab-jamun"],
    challenge: { kind: "fingers", code: "4721", fingers: 2, issuedAt: 1, capturedAt: 2, expiresAt: 3 },
    challengeCheck: { seal_code_read: "4721", fingers_visible: 2, seal_state: "broken", photo_of_screen_suspected: false, confidence: "high" },
    damageCheck: { matched_item: "Gulab Jamun", issue: "spilled", severity: "partial", confidence: "medium" },
    moireScore: 0.1,
    cropSha256: "a".repeat(64),
    cropRef: "claims/c1/crop.jpg",
    inferenceSources: { challenge: "ON_DEVICE", damage: "IN_CLOUD" },
    customerClaims30d: 0,
  };
  it("accepts a well-formed claim", () => expect(validateClaimEvidence(claim)).toBe(true));
  it("rejects a crop path for another claim id pattern", () => expect(validateClaimEvidence({ ...claim, cropRef: "../etc/passwd" })).toBe(false));
  it("rejects unknown keys", () => expect(validateClaimEvidence({ ...claim, refund: 9999 })).toBe(false));
  it("rejects a 4-finger challenge", () => expect(validateClaimEvidence({ ...claim, challenge: { ...claim.challenge, fingers: 4 } })).toBe(false));
});

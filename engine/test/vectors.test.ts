import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defaultPolicy, validateEngineDecision, type DispatchCheck, type EngineInput, type Policy } from "@fairclaim/schemas";
import { decide, EngineError, namesMatch, resolveCounterEvidence } from "../src/index.ts";

const require = createRequire(import.meta.url);
const load = <T>(name: string): T => JSON.parse(readFileSync(require.resolve(`@fairclaim/schemas/test-vectors/${name}`), "utf8")) as T;

type VectorInput = Omit<EngineInput, "policy">;
interface EngineVector {
  name: string;
  matrixRow: string;
  policyPatch?: Partial<Policy>;
  input: VectorInput;
  expected: unknown;
}
interface CounterVector {
  name: string;
  policyPatch?: Partial<Policy>;
  input: VectorInput;
  counterCheck: DispatchCheck;
  expected: unknown;
}

const withPolicy = (input: VectorInput, patch?: Partial<Policy>): EngineInput => ({ ...input, policy: { ...defaultPolicy, ...patch } });

const engineVectors = load<EngineVector[]>("engine.vectors.json");
const counterVectors = load<CounterVector[]>("counter-evidence.vectors.json");
const matchVectors = load<{ a: string; b: string; expected: boolean }[]>("item-match.vectors.json");

describe("decision engine — shared vectors", () => {
  it.each(engineVectors.map((v) => [`[${v.matrixRow}] ${v.name}`, v] as const))("%s", (_, v) => {
    const out = decide(withPolicy(v.input, v.policyPatch));
    expect(out).toEqual(v.expected);
    expect(validateEngineDecision(out)).toBe(true);
    expect(out.liability.restaurant + out.liability.transit + out.liability.platform).toBe(out.refundAmount);
  });

  it("covers every §8.2 matrix row and every default", () => {
    const rows = new Set(engineVectors.map((v) => v.matrixRow));
    const required = [
      "8.1", "8.3", "8.4", "8.2.key-rule",
      "8.2.missing.1", "8.2.missing.2", "8.2.missing.3", "8.2.missing.4", "8.2.missing.5",
      "8.2.damage.1", "8.2.damage.2", "8.2.damage.3", "8.2.damage.4",
      "8.2.wrong.1", "8.2.wrong.2",
      "default.1", "default.2", "default.3", "default.4", "default.5",
    ];
    expect(required.filter((r) => !rows.has(r))).toEqual([]);
  });

  it("never mutates its input", () => {
    const v = engineVectors[0];
    if (!v) throw new Error("no vectors");
    const input = withPolicy(v.input);
    const snapshot = structuredClone(input);
    decide(input);
    expect(input).toEqual(snapshot);
  });
});

describe("counter-evidence — shared vectors", () => {
  it.each(counterVectors.map((v) => [v.name, v] as const))("%s", (_, v) => {
    const input = withPolicy(v.input, v.policyPatch);
    const decision = decide(input);
    const expected = v.expected as { error?: string };
    if (expected.error) {
      expect(() => resolveCounterEvidence(input, decision, v.counterCheck)).toThrow(EngineError);
      try {
        resolveCounterEvidence(input, decision, v.counterCheck);
      } catch (e) {
        expect((e as EngineError).code).toBe(expected.error);
      }
    } else {
      expect(resolveCounterEvidence(input, decision, v.counterCheck)).toEqual(v.expected);
    }
  });
});

describe("item-name matching — shared vectors", () => {
  it.each(matchVectors.map((v) => [`${JSON.stringify(v.a)} ~ ${JSON.stringify(v.b)}`, v] as const))("%s", (_, v) => {
    expect(namesMatch(v.a, v.b)).toBe(v.expected);
    expect(namesMatch(v.b, v.a)).toBe(v.expected);
  });
});

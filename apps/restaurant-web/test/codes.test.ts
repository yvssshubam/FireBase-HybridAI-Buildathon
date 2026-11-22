import { describe, expect, it } from "vitest";
import { generatePairCode, generateSealCode, PAIR_ALPHABET } from "../src/data/codes.ts";

/** Feeds fixed values into the buffer, in order, one per call (or per element). */
function scripted(values: number[]) {
  let i = 0;
  return (buf: Uint16Array<ArrayBuffer> | Uint8Array<ArrayBuffer>) => {
    for (let j = 0; j < buf.length; j++) buf[j] = values[i++ % values.length] ?? 0;
  };
}

describe("generateSealCode", () => {
  it("is always 4 digits, zero-padded", () => {
    expect(generateSealCode(scripted([7]))).toBe("0007");
    expect(generateSealCode(scripted([4721]))).toBe("4721");
    expect(generateSealCode(scripted([59999]))).toBe("9999");
  });

  it("rejects values ≥ 60000 (avoids modulo bias) and draws again", () => {
    expect(generateSealCode(scripted([65535, 60000, 12345]))).toBe("2345");
  });

  it("throws on a broken random source instead of looping forever", () => {
    expect(() => generateSealCode(scripted([65535]))).toThrow();
  });

  it("uses crypto.getRandomValues by default and spreads over all digits", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generateSealCode();
      expect(c).toMatch(/^[0-9]{4}$/);
      for (const ch of c) seen.add(ch);
    }
    expect(seen.size).toBe(10);
  });
});

describe("generatePairCode", () => {
  const RULE = /^[A-HJ-NP-Z2-9]{6}$/; // firestore.rules pairCodes/{code}

  it("matches the rules' pattern", () => {
    for (let i = 0; i < 1000; i++) expect(generatePairCode()).toMatch(RULE);
  });

  it("alphabet is exactly the 32 symbols the rules allow", () => {
    expect(PAIR_ALPHABET).toHaveLength(32);
    expect(new Set(PAIR_ALPHABET).size).toBe(32);
    for (const ch of PAIR_ALPHABET) expect(ch).toMatch(/^[A-HJ-NP-Z2-9]$/);
  });

  it("maps bytes with & 31", () => {
    expect(generatePairCode(scripted([0, 31, 32, 255, 8, 23]))).toBe("A9A9JZ");
  });
});

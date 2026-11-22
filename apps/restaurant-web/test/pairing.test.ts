import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { generatePairCode } from "../src/data/codes.ts";
import { pairPayload, parsePairPayload, qrMatrix } from "../src/data/pairing.ts";

/** Renders modules to RGBA (4-module quiet zone) so a real decoder can read it back. */
function decode(matrix: boolean[][]): string | null {
  const scale = 4;
  const quiet = 4;
  const n = matrix.length;
  const size = (n + quiet * 2) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
    }),
  );
  return jsQR(px, size, size)?.data ?? null;
}

describe("pairing QR", () => {
  it("encodes the pair code in a fixed URI", () => {
    expect(pairPayload("K7QM4P")).toBe("fairclaim://pair?code=K7QM4P");
    expect(() => pairPayload("k7qm4p")).toThrow();
    expect(() => pairPayload("K7QM4")).toThrow();
  });

  it("round-trips through a real QR decoder", () => {
    for (let i = 0; i < 20; i++) {
      const code = generatePairCode();
      const m = qrMatrix(pairPayload(code));
      expect(m.length).toBeGreaterThanOrEqual(21);
      expect(parsePairPayload(decode(m) ?? "")).toBe(code);
    }
  });

  it("rejects anything that isn't a FairClaim pairing payload", () => {
    for (const bad of ["K7QM4P", "https://example.com/?code=K7QM4P", "fairclaim://pair?code=K7QM4I", "fairclaim://pair?code=K7QM4P&x=1"]) {
      expect(parsePairPayload(bad)).toBeNull();
    }
    expect(parsePairPayload("  fairclaim://pair?code=ABCDEF \n")).toBe("ABCDEF");
  });
});

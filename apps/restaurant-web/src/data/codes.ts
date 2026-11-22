// Crypto-random codes. `fill` is injectable for tests; production uses crypto.getRandomValues.
type Fill = (buf: Uint16Array<ArrayBuffer> | Uint8Array<ArrayBuffer>) => void;
const cryptoFill: Fill = (buf) => void crypto.getRandomValues(buf);

/** Uniform 4-digit seal code "0000"–"9999" (rejection sampling avoids modulo bias). */
export function generateSealCode(fill: Fill = cryptoFill): string {
  const buf = new Uint16Array(1);
  for (let i = 0; i < 1000; i++) {
    fill(buf);
    const v = buf[0] ?? 0;
    if (v < 60000) return String(v % 10000).padStart(4, "0");
  }
  throw new Error("random source is not random");
}

// firestore.rules: pairCodes/{code} must match ^[A-HJ-NP-Z2-9]{6}$ (no I, O, 0, 1).
export const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 6-character pair code; the alphabet has 32 symbols, so `byte & 31` is unbiased. */
export function generatePairCode(fill: Fill = cryptoFill): string {
  const buf = new Uint8Array(6);
  fill(buf);
  return Array.from(buf, (b) => PAIR_ALPHABET[b & 31]).join("");
}

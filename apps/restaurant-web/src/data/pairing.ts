// Pairing a customer's phone with this sandbox restaurant (Decision 1). The web app
// shows a QR code; the Android app scans it. The code inside is the pairCodes/{code} id.
import qrcode from "qrcode-generator";

const CODE = /^[A-HJ-NP-Z2-9]{6}$/; // firestore.rules pairCodes/{code}

/** What the QR encodes. The Android app (Phase 2) parses this exact format. */
export function pairPayload(code: string): string {
  if (!CODE.test(code)) throw new Error(`not a pair code: ${code}`);
  return `fairclaim://pair?code=${code}`;
}

/** The pair code inside a scanned payload, or null. Mirrors what the Android app must accept. */
export function parsePairPayload(text: string): string | null {
  const m = /^fairclaim:\/\/pair\?code=([A-HJ-NP-Z2-9]{6})$/.exec(text.trim());
  return m?.[1] ?? null;
}

/** QR modules (true = dark), error correction M, smallest version that fits. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

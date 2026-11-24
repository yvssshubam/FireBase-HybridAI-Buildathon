// Scans a built Android APK for things that must never ship in the judge build: the App Check
// debug provider (class names, its registrar, its log text), debug tokens, dev/emulator code and
// private keys. Searches every entry (dex, binary manifest, resources) as UTF-8 and UTF-16LE.
//   npm run check:apk -- apps/customer-android/app/build/outputs/apk/release/app-release.apk
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const path = process.argv[2];
if (!path) {
  console.error("usage: npm run check:apk -- <path/to/app-release.apk>");
  process.exit(2);
}
const zip = readFileSync(path);

/** Minimal ZIP reader (central directory → local headers); APKs are plain ZIPs. */
function* entries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP/APK file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    yield { name, data: method === 8 ? inflateRawSync(raw) : raw };
    p += 46 + nameLen + extraLen + commentLen;
  }
}

const NEEDLES = [
  ["DebugAppCheckProvider", "App Check debug provider class"],
  ["appcheck/debug", "App Check debug provider package"],
  ["appcheck.debug", "App Check debug provider package / registrar"],
  ["Enter this debug secret", "App Check debug provider log text"],
  ["FIREBASE_APPCHECK_DEBUG_TOKEN", "debug token variable"],
  ["demo-fairclaim", "emulator project id"],
  ["10.0.2.2:", "emulator host"],
  ["-----BEGIN PRIVATE KEY-----", "private key"],
  ["\"private_key\"", "service account key"],
];

const problems = [];
let scanned = 0;
for (const { name, data } of entries(zip)) {
  scanned++;
  for (const [needle, what] of NEEDLES) {
    if (data.includes(Buffer.from(needle, "utf8")) || data.includes(Buffer.from(needle, "utf16le"))) {
      problems.push(`${name}: ${what} ("${needle}")`);
    }
  }
}
if (problems.length > 0) {
  console.error(`✗ ${path}\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`✓ ${path}: ${scanned} entries scanned, no debug provider, debug tokens, emulator config or keys.`);

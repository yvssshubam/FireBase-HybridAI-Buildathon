// Scans apps/restaurant-web/dist after `npm run build` for things that must never ship:
// App Check debug tokens, dev/emulator code, secrets, env files, source maps.
//   npm run build && npm run check:dist
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows .pathname gives "/C:/..." which fs can't open.
const dist = fileURLToPath(new URL("../apps/restaurant-web/dist/", import.meta.url));
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
try {
  walk(dist);
} catch {
  console.error("No dist/ yet: run `npm run build` first.");
  process.exit(2);
}

const RULES = [
  // The SDK reads the global (that code is fine); our app must never assign it in production.
  [/FIREBASE_APPCHECK_DEBUG_TOKEN\s*=[^=]/, "App Check debug token assignment"],
  [/dev-debug-token-only|VITE_APPCHECK_DEBUG_TOKEN/, "dev-only App Check code"],
  [/demo-fairclaim|127\.0\.0\.1:(9099|8080|9199)|customer-sim/, "emulator / dev helper code"],
  // Dev-only demo data (apps/restaurant-web/src/demo/demoData.ts) must never ship.
  [/demo-c-|demo-o-|dQ8xZk2LmR7aP3/, "demo data"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"|client_secret/, "private key / secret"],
];
const problems = [];
for (const f of files) {
  const rel = relative(dist, f);
  if (/(^|\/)\.env/.test(rel)) problems.push(`${rel}: env file in the build`);
  if (rel.endsWith(".map")) problems.push(`${rel}: source map in the build`);
  if (!/\.(js|html|css|json|txt|svg)$/.test(rel)) continue;
  const text = readFileSync(f, "utf8");
  for (const [re, what] of RULES) if (re.test(text)) problems.push(`${rel}: ${what} (${re})`);
}
const keys = new Set(files.filter((f) => f.endsWith(".js")).flatMap((f) => readFileSync(f, "utf8").match(/AIza[0-9A-Za-z_-]{30,}/g) ?? []));
if (problems.length > 0) {
  console.error(`✗ dist/ check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`✓ dist/ clean: ${files.length} files; no debug token, dev/emulator code, demo data, secrets, env files or source maps.`);
console.log(`  Firebase web API keys present (public by design; restrict them by HTTP referrer): ${keys.size === 0 ? "none" : [...keys].map((k) => k.slice(0, 8) + "…").join(", ")}`);

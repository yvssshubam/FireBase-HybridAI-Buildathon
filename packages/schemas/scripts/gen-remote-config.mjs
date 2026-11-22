// Builds the Remote Config template from policy/policy.v1.json so the apps
// (Remote Config) and the security rules (Firestore config/policy, seeded by
// scripts/seed-policy.mjs) read the same numbers from one file.
// Usage: node scripts/gen-remote-config.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(join(here, "..", "policy", "policy.v1.json"), "utf8"));
const outFile = join(here, "..", "..", "..", "remoteconfig.template.json");

const template = {
  parameters: {
    policy_json: {
      defaultValue: { value: JSON.stringify(policy) },
      valueType: "JSON",
      description: "FairClaim refund policy (generated from packages/schemas/policy). Edit the file, not the console.",
    },
    policy_version: {
      defaultValue: { value: policy.policyVersion },
      valueType: "STRING",
      description: "Must equal policy_json.policyVersion and Firestore config/policy.policyVersion.",
    },
  },
};
const text = JSON.stringify(template, null, 2) + "\n";

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(outFile, "utf8");
  } catch {
    // missing file is stale
  }
  if (current !== text) {
    console.error("remoteconfig.template.json is stale — run `npm run gen`.");
    process.exit(1);
  }
  console.log("remoteconfig.template.json is up to date.");
} else {
  writeFileSync(outFile, text);
  console.log(`wrote ${outFile}`);
}

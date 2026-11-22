// Writes Firestore config/policy from packages/schemas/policy/policy.v1.json,
// so the security rules see the same cap/hold window as the apps' Remote Config.
//
//   gcloud auth application-default login      # or GOOGLE_APPLICATION_CREDENTIALS=<service account json>
//   node scripts/seed-policy.mjs <firebase-project-id>
//
// Against the emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-policy.mjs demo-fairclaim
import { readFileSync } from "node:fs";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.argv[2];
if (!projectId) {
  console.error("usage: node scripts/seed-policy.mjs <firebase-project-id>");
  process.exit(2);
}
const policy = JSON.parse(readFileSync(new URL("../packages/schemas/policy/policy.v1.json", import.meta.url), "utf8"));

const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
initializeApp({ projectId, ...(emulated ? {} : { credential: applicationDefault() }) });
await getFirestore().doc("config/policy").set({
  policyVersion: policy.policyVersion,
  autoApproveCap: policy.autoApproveCap,
  holdHours: policy.holdHours,
  policyJson: JSON.stringify(policy),
});
console.log(`config/policy = ${policy.policyVersion} written to ${projectId}${emulated ? " (emulator)" : ""}`);

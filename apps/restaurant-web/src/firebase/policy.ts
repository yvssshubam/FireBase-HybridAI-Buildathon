// Refund policy from Remote Config `policy_json`, falling back to the bundled default.
// Firestore config/policy (seeded from the same file) is what the security rules check.
import { defaultPolicy, parsePolicy, type Policy } from "@fairclaim/schemas";
import { fetchAndActivate, getValue, type RemoteConfig } from "firebase/remote-config";
import { errorText } from "../errors.ts";

export interface LoadedPolicy {
  policy: Policy;
  source: "remote" | "default";
  /** Why the remote value wasn't used (shown in the header tooltip). */
  note: string | null;
}

const FETCH_TIMEOUT_MS = 8000;

export async function loadPolicy(rc: RemoteConfig): Promise<LoadedPolicy> {
  rc.settings.fetchTimeoutMillis = FETCH_TIMEOUT_MS;
  rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 60 * 60 * 1000;
  rc.defaultConfig = { policy_json: JSON.stringify(defaultPolicy) };
  try {
    await fetchAndActivate(rc);
  } catch (e) {
    return { policy: defaultPolicy, source: "default", note: `Remote Config fetch failed: ${errorText(e)}` };
  }
  const value = getValue(rc, "policy_json");
  if (value.getSource() !== "remote") {
    return { policy: defaultPolicy, source: "default", note: "Remote Config has no policy_json parameter yet" };
  }
  try {
    return { policy: parsePolicy(value.asString()), source: "remote", note: null };
  } catch (e) {
    return { policy: defaultPolicy, source: "default", note: `Remote policy_json is invalid: ${errorText(e)}` };
  }
}

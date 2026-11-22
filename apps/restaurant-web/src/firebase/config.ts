// Reads the public Firebase web config from VITE_* env vars (see .env.example).
import type { FirebaseOptions } from "firebase/app";

export interface WebConfig {
  firebase: FirebaseOptions & { apiKey: string; projectId: string; appId: string };
  recaptchaSiteKey: string;
  useEmulators: boolean;
}

export type ConfigResult = { ok: true; config: WebConfig } | { ok: false; missing: string[] };

type Env = Readonly<Record<string, string | boolean | undefined>>;

const REQUIRED = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

const str = (env: Env, key: string): string => {
  const v = env[key];
  return typeof v === "string" ? v.trim() : "";
};

/** `isDev` relaxes only the reCAPTCHA key (the debug provider is used in dev). */
export function readConfig(env: Env, isDev: boolean): ConfigResult {
  const missing: string[] = REQUIRED.filter((k) => str(env, k) === "");
  const recaptchaSiteKey = str(env, "VITE_RECAPTCHA_ENTERPRISE_SITE_KEY");
  if (!isDev && recaptchaSiteKey === "") missing.push("VITE_RECAPTCHA_ENTERPRISE_SITE_KEY");
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: {
      firebase: {
        apiKey: str(env, "VITE_FIREBASE_API_KEY"),
        authDomain: str(env, "VITE_FIREBASE_AUTH_DOMAIN"),
        projectId: str(env, "VITE_FIREBASE_PROJECT_ID"),
        storageBucket: str(env, "VITE_FIREBASE_STORAGE_BUCKET"),
        messagingSenderId: str(env, "VITE_FIREBASE_MESSAGING_SENDER_ID"),
        appId: str(env, "VITE_FIREBASE_APP_ID"),
      },
      recaptchaSiteKey,
      // Emulators are a dev-only convenience; a production build always talks to the real project.
      useEmulators: isDev && str(env, "VITE_USE_EMULATORS") === "true",
    },
  };
}

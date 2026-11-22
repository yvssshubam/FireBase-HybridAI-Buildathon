// Firebase bootstrap. App Check is initialised before any other service so every
// request (AI Logic, Firestore, Storage, Remote Config) carries a token.
import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { getRemoteConfig, type RemoteConfig } from "firebase/remote-config";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";
import type { WebConfig } from "./config.ts";

export interface Services {
  /** The real project: App Check, AI Logic, Remote Config. */
  app: FirebaseApp;
  ai: AI;
  remoteConfig: RemoteConfig;
  /** Data services: the real project, or the local emulators (project demo-fairclaim) in emulator mode. */
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  emulated: boolean;
  projectId: string;
}

// Must match .firebaserc / `npm run emulators` and dev/customer-sim.ts.
export const EMULATOR_PROJECT = "demo-fairclaim";

let services: Services | null = null;

export function initServices(config: WebConfig): Services {
  if (services) return services;
  const app = initializeApp(config.firebase);

  // Debug token ONLY in dev builds: `import.meta.env.DEV` is a compile-time constant,
  // so this whole block is removed from the production bundle.
  if (import.meta.env.DEV) {
    const fixed = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN?.trim();
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = fixed ? fixed : true;
    if (!config.recaptchaSiteKey) {
      console.warn("[FairClaim] No VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: relying on the App Check debug token (dev only).");
    }
  }
  initializeAppCheck(app, {
    // The provider is always initialised (it loads reCAPTCHA), even when the debug token is used.
    provider: new ReCaptchaEnterpriseProvider(import.meta.env.DEV ? config.recaptchaSiteKey || "dev-debug-token-only" : config.recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });

  // Limited-use tokens are ready for AI Logic replay protection (PLAN §22.1 L3).
  const ai = getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });
  const remoteConfig = getRemoteConfig(app);

  // Emulator wiring is dev-only code; production bundles drop it entirely.
  const emulated = import.meta.env.DEV && config.useEmulators;
  let dataApp = app;
  if (emulated) {
    // A separate "demo-" app: emulator data can never reach the real project.
    dataApp = initializeApp(
      {
        apiKey: "demo-key",
        projectId: EMULATOR_PROJECT,
        appId: "1:000000000000:web:demo",
        storageBucket: `${EMULATOR_PROJECT}.appspot.com`,
        authDomain: `${EMULATOR_PROJECT}.firebaseapp.com`,
      },
      "emulated-data",
    );
  }
  const auth = getAuth(dataApp);
  const db = getFirestore(dataApp);
  const storage = getStorage(dataApp);
  if (emulated) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }

  services = {
    app,
    ai,
    remoteConfig,
    auth,
    db,
    storage,
    emulated,
    projectId: emulated ? EMULATOR_PROJECT : config.firebase.projectId,
  };
  return services;
}

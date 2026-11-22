/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?: string;
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
  readonly VITE_USE_EMULATORS?: string;
  readonly VITE_CONTACT_EMAIL?: string;
  readonly VITE_DEMO_DATA?: string;
  readonly VITE_ALLOW_PHOTO_UPLOAD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Read by the App Check SDK (getGlobal().FIREBASE_APPCHECK_DEBUG_TOKEN). Set only in dev builds.
// `var` (not let/const) is what adds the property to globalThis/self.
// eslint-disable-next-line no-var
declare var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined;

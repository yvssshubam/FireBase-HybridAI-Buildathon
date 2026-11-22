import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import { LEGAL_LAST_UPDATED, TERMS_VERSION } from "./src/legal.ts";

const root = import.meta.dirname;
const REQUIRED_FOR_PRODUCTION = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_RECAPTCHA_ENTERPRISE_SITE_KEY",
];
const EMAIL =/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/** /terms and /privacy are static pages; Vercel serves them via cleanUrls, dev/preview need a rewrite. */
function legalPages(contactEmail: string): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url === "/terms" || req.url === "/privacy") req.url += ".html";
    next();
  };
  return {
    name: "fairclaim-legal-pages",
    transformIndexHtml: (html) =>
      html
        .replaceAll("__TERMS_VERSION__", TERMS_VERSION)
        .replaceAll("__LEGAL_LAST_UPDATED__", LEGAL_LAST_UPDATED)
        .replaceAll("__CONTACT_EMAIL__", contactEmail),
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, root, "VITE_");
  // The App Check debug token is only read in dev (import.meta.env.DEV), but never let
  // it near a production bundle in the first place.
  if (command === "build" && mode === "production" && env.VITE_APPCHECK_DEBUG_TOKEN) {
    throw new Error("VITE_APPCHECK_DEBUG_TOKEN must not be set for production builds.");
  }
  if (command === "build" && mode === "production") {
    // A deploy without config would only show the "not configured" screen to judges: fail here instead.
    const missing = REQUIRED_FOR_PRODUCTION.filter((k) => !env[k]?.trim());
    if (missing.length > 0) throw new Error(`Missing env vars for a production build: ${missing.join(", ")} (see apps/restaurant-web/.env.example).`);
  }
  const contact = env.VITE_CONTACT_EMAIL ?? "";
  if (command === "build" && mode === "production" && !EMAIL.test(contact)) {
    throw new Error("Set VITE_CONTACT_EMAIL (shown on /terms and /privacy as the grievance contact) before a production build.");
  }
  return {
    plugins: [react(), legalPages(EMAIL.test(contact) ? contact : "(contact email not configured)")],
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
      // One ~1 MB bundle (Firebase + React + validators) is fine for a single-screen app.
      chunkSizeWarningLimit: 1200,
      rolldownOptions: {
        input: {
          main: resolve(root, "index.html"),
          terms: resolve(root, "terms.html"),
          privacy: resolve(root, "privacy.html"),
        },
      },
    },
  };
});

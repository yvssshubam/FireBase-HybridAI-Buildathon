// One place for the Terms/Privacy version. The static /terms and /privacy pages
// get these values injected at build time (vite.config.ts), and the acceptance
// gate stores TERMS_VERSION in users/{uid}. Bump both when the text changes.
// The grievance/contact address comes from VITE_CONTACT_EMAIL (required for production builds).
export const TERMS_VERSION = "2026-11-22";
export const LEGAL_LAST_UPDATED = "22 November 2026";

// Turns SDK errors into messages a restaurant can act on.

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "unknown error";
}

function errorCode(e: unknown): string {
  if (typeof e === "object" && e !== null && "code" in e && typeof e.code === "string") return e.code;
  return "";
}

/** Short, human-readable explanation plus the raw code for support. */
export function friendlyError(e: unknown): string {
  const code = errorCode(e);
  const raw = errorText(e);
  const text = `${code} ${raw}`.toLowerCase();
  if (text.includes("app-check") || text.includes("appcheck")) {
    return `App Check rejected this request. In development, register the debug token printed in the console (Firebase console → App Check → Apps → Manage debug tokens). (${code || raw})`;
  }
  if (code === "permission-denied" || code === "storage/unauthorized") {
    return `The security rules rejected this change. Reload to get the latest state and try again. (${code})`;
  }
  if (code === "unavailable" || code === "storage/retry-limit-exceeded" || text.includes("network") || text.includes("failed to fetch")) {
    return `Can't reach Firebase right now. Check the connection and try again. (${code || raw})`;
  }
  if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
    return `Anonymous sign-in is turned off for this Firebase project (Authentication → Sign-in method → Anonymous). (${code})`;
  }
  if (code === "storage/object-not-found") return "The image is no longer stored (images are deleted after 3 days).";
  return code ? `${raw} (${code})` : raw;
}

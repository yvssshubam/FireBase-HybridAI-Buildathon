// Anonymous sign-in: every browser profile gets its own sandbox restaurant (Decision 1).
import { signInAnonymously, signOut, type Auth, type User } from "firebase/auth";

// The saved login points at a user that no longer exists (Auth emulator restarted, or the
// anonymous user was deleted in the console). Only these codes mean "start over": a
// network error must NOT, because a new anonymous user means a new, empty restaurant.
const GONE = new Set(["auth/invalid-refresh-token", "auth/user-token-expired", "auth/user-not-found"]);

const code = (e: unknown) => (typeof e === "object" && e !== null && "code" in e ? String(e.code) : "");

export async function ensureSignedIn(auth: Auth): Promise<User> {
  // Wait for persisted state first, so a reload keeps the same uid (and restaurant).
  await auth.authStateReady();
  const current = auth.currentUser;
  if (current) {
    try {
      await current.getIdToken(); // proves the saved login is still valid
      return current;
    } catch (e) {
      if (!GONE.has(code(e))) throw e;
      await signOut(auth);
    }
  }
  const cred = await signInAnonymously(auth);
  return cred.user;
}

// First run: Terms acceptance (users/{uid}) and the sandbox restaurant + pair code.
import { doc, getDoc, serverTimestamp, setDoc, writeBatch, type Firestore } from "firebase/firestore";
import { TERMS_VERSION } from "../legal.ts";
import { generatePairCode } from "./codes.ts";
import { parseRestaurant, type RestaurantDoc } from "./docs.ts";
import { SANDBOX_RESTAURANT_NAME, SEED_MENU } from "./menu.ts";

export async function hasAcceptedTerms(db: Firestore, uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "users", uid));
  const data = snap.data();
  return data !== undefined && data.termsVersion === TERMS_VERSION && data.role === "restaurant";
}

export async function acceptTerms(db: Firestore, uid: string): Promise<void> {
  await setDoc(doc(db, "users", uid), { termsVersion: TERMS_VERSION, acceptedAt: serverTimestamp(), role: "restaurant" });
}

export async function getRestaurant(db: Firestore, uid: string): Promise<RestaurantDoc | null> {
  const snap = await getDoc(doc(db, "restaurants", uid));
  return snap.exists() ? parseRestaurant(uid, snap.data()) : null;
}

const MAX_CODE_TRIES = 5;

/**
 * Creates restaurants/{uid} and pairCodes/{code} in one batch (the rules require both).
 * A taken code makes the batch fail (pair codes are create-once), so try a new one.
 */
export async function createRestaurant(db: Firestore, uid: string): Promise<RestaurantDoc> {
  let lastError: unknown = null;
  for (let i = 0; i < MAX_CODE_TRIES; i++) {
    const code = generatePairCode();
    const b = writeBatch(db);
    b.set(doc(db, "restaurants", uid), { name: SANDBOX_RESTAURANT_NAME, pairCode: code, menu: SEED_MENU, createdAt: serverTimestamp() });
    b.set(doc(db, "pairCodes", code), { restaurantId: uid });
    try {
      await b.commit();
      return { id: uid, name: SANDBOX_RESTAURANT_NAME, pairCode: code, menu: { ...SEED_MENU } };
    } catch (e) {
      lastError = e;
      // Another tab may have created it meanwhile.
      const existing = await getRestaurant(db, uid);
      if (existing) return existing;
      const taken = (await getDoc(doc(db, "pairCodes", code))).exists();
      if (!taken) throw e; // not a collision: surface the real error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not find a free pair code. Try again.");
}

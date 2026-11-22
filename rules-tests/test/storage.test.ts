import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { deleteObject, getBytes, getMetadata, listAll, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { ago, clearStorageDeep, CUST, fs, jpeg, MALLORY, REST, REST2, seedBase, setup, st } from "./helpers.ts";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await clearStorageDeep(env);
  await seedBase(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(fs(ctx), "challenges/c1"), { customerId: CUST, orderId: "o1", restaurantId: REST, kind: "fingers", fingers: 2, issuedAt: ago(0) });
    await setDoc(doc(fs(ctx), "challenges/old"), { customerId: CUST, orderId: "o1", restaurantId: REST, kind: "fingers", fingers: 2, issuedAt: ago(180_000) });
  });
});

const storageOf = (uid: string) => st(env.authenticatedContext(uid));
const JPEG = { contentType: "image/jpeg" };

describe("claim crops (§22.5)", () => {
  it("owner uploads a small JPEG crop inside the challenge window", async () => {
    await assertSucceeds(uploadBytes(ref(storageOf(CUST), "claims/c1/crop.jpg"), jpeg(), JPEG));
  });
  it("rejects crops of 300 KB or more", async () => {
    await assertFails(uploadBytes(ref(storageOf(CUST), "claims/c1/crop.jpg"), jpeg(300 * 1024), JPEG));
  });
  it("rejects non-JPEG uploads", async () => {
    await assertFails(uploadBytes(ref(storageOf(CUST), "claims/c1/crop.jpg"), jpeg(), { contentType: "image/png" }));
  });
  it("rejects uploads after the challenge window", async () => {
    await assertFails(uploadBytes(ref(storageOf(CUST), "claims/old/crop.jpg"), jpeg(), JPEG));
  });
  it("is create-once (no swapping the crop after verification)", async () => {
    await uploadBytes(ref(storageOf(CUST), "claims/c1/crop.jpg"), jpeg(), JPEG);
    await assertFails(uploadBytes(ref(storageOf(CUST), "claims/c1/crop.jpg"), jpeg(2048), JPEG));
  });
  it("other users cannot upload it", async () => {
    await assertFails(uploadBytes(ref(storageOf(MALLORY), "claims/c1/crop.jpg"), jpeg(), JPEG));
    await assertFails(uploadBytes(ref(storageOf(REST), "claims/c1/crop.jpg"), jpeg(), JPEG));
  });
  it("owner and the order's restaurant can read it; others cannot", async () => {
    await uploadBytes(ref(storageOf(CUST), "claims/c1/crop.jpg"), jpeg(), JPEG);
    await assertSucceeds(getBytes(ref(storageOf(CUST), "claims/c1/crop.jpg")));
    await assertSucceeds(getBytes(ref(storageOf(REST), "claims/c1/crop.jpg")));
    await assertFails(getBytes(ref(storageOf(REST2), "claims/c1/crop.jpg")));
    await assertFails(getBytes(ref(storageOf(MALLORY), "claims/c1/crop.jpg")));
  });
  it("only the owner deletes it (Delete my data)", async () => {
    await uploadBytes(ref(storageOf(CUST), "claims/c1/crop.jpg"), jpeg(), JPEG);
    await assertFails(deleteObject(ref(storageOf(REST), "claims/c1/crop.jpg")));
    await assertSucceeds(deleteObject(ref(storageOf(CUST), "claims/c1/crop.jpg")));
  });
  it("listing is denied", async () => {
    await assertFails(listAll(ref(storageOf(CUST), "claims/c1")));
  });
});

describe("dispatch thumbnails and counter photos", () => {
  it("restaurant uploads a dispatch thumbnail under 60 KB", async () => {
    await assertSucceeds(uploadBytes(ref(storageOf(REST), "dispatch/o1/thumb.jpg"), jpeg(), JPEG));
    await assertFails(uploadBytes(ref(storageOf(REST2), "dispatch/o1/thumb.jpg"), jpeg(), JPEG));
  });
  it("rejects a thumbnail of 60 KB or more", async () => {
    await assertFails(uploadBytes(ref(storageOf(REST), "dispatch/o1/thumb.jpg"), jpeg(60 * 1024), JPEG));
  });
  it("customer cannot read the restaurant's thumbnail", async () => {
    await uploadBytes(ref(storageOf(REST), "dispatch/o1/thumb.jpg"), jpeg(), JPEG);
    await assertFails(getBytes(ref(storageOf(CUST), "dispatch/o1/thumb.jpg")));
  });
  it("restaurant uploads a counter photo; the customer can see it", async () => {
    await assertSucceeds(uploadBytes(ref(storageOf(REST), "counter/c1/photo.jpg"), jpeg(), JPEG));
    await assertSucceeds(getBytes(ref(storageOf(CUST), "counter/c1/photo.jpg")));
    await assertFails(uploadBytes(ref(storageOf(CUST), "counter/c1/photo.jpg"), jpeg(), JPEG));
  });
  it("web app: uploads carry a sha256 custom metadata field; the uploader can read it back to retry safely", async () => {
    const meta = { contentType: "image/jpeg", customMetadata: { sha256: "a".repeat(64) } };
    await assertSucceeds(uploadBytes(ref(storageOf(REST), "dispatch/o1/thumb.jpg"), jpeg(), meta));
    await assertSucceeds(uploadBytes(ref(storageOf(REST), "counter/c1/photo.jpg"), jpeg(), meta));
    await assertSucceeds(getMetadata(ref(storageOf(REST), "dispatch/o1/thumb.jpg")));
    await assertSucceeds(getMetadata(ref(storageOf(REST), "counter/c1/photo.jpg")));
    // A second upload is still refused (create-once).
    await assertFails(uploadBytes(ref(storageOf(REST), "counter/c1/photo.jpg"), jpeg(2048), meta));
  });
  it("everything else is closed", async () => {
    await assertFails(uploadBytes(ref(storageOf(CUST), "anything/else.jpg"), jpeg(), JPEG));
  });
});
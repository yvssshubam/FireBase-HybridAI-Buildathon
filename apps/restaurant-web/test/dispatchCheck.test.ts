import { describe, expect, it } from "vitest";
import { runDispatchCheck, type Generate } from "../src/ai/dispatchCheck.ts";
import { toWireSource } from "../src/ai/model.ts";
import { assessDispatch } from "../src/data/dispatchAssess.ts";
import { readConfig } from "../src/firebase/config.ts";

const good = JSON.stringify({
  seal_intact: true,
  seal_code_read: "4721",
  spill_or_damage_visible: false,
  confidence: "high",
});
const image = { base64: "AAAA" };

/** Test double for a model call: returns/throws the scripted results in order. */
function scripted(steps: (string | Error)[], source: "ON_DEVICE" | "IN_CLOUD"): Generate & { readonly calls: number } {
  let calls = 0;
  const g: Generate = async () => {
    const s = steps[calls++];
    if (s instanceof Error) throw s;
    return { text: s ?? "", source };
  };
  return Object.defineProperty(g, "calls", { get: () => calls }) as Generate & { readonly calls: number };
}

describe("runDispatchCheck: validate, one retry in the cloud, then fail", () => {
  it("accepts a valid first answer without retrying", async () => {
    const first = scripted([good], "ON_DEVICE");
    const retry = scripted([good], "IN_CLOUD");
    const r = await runDispatchCheck({ first, retry }, "p", image);
    expect(r).toMatchObject({ ok: true, source: "ON_DEVICE", attempts: 1 });
    expect(first.calls).toBe(1);
    expect(retry.calls).toBe(0);
  });

  it("normalizes verbose output (fences, code with spaces, uppercase enum)", async () => {
    const verbose = "```json\n" + good.replace('"4721"', '"47 21"').replace('"high"', '"HIGH"') + "\n```";
    const r = await runDispatchCheck({ first: scripted([verbose], "ON_DEVICE"), retry: scripted([], "IN_CLOUD") }, "p", image);
    expect(r.ok && r.check.seal_code_read).toBe("4721");
    expect(r.ok && r.check.confidence).toBe("high");
  });

  it("retries in the cloud when the first answer fails the schema", async () => {
    const retry = scripted([good], "IN_CLOUD");
    const r = await runDispatchCheck({ first: scripted(['{"seal_intact":"yes"}'], "ON_DEVICE"), retry }, "p", image);
    expect(retry.calls).toBe(1);
    expect(r).toMatchObject({ ok: true, source: "IN_CLOUD", attempts: 2 });
    expect(r.ok && r.failures[0]?.error).toMatch(/invalid model output \(schema/);
  });

  it("retries in the cloud when the first call throws (e.g. on-device session error)", async () => {
    const r = await runDispatchCheck({ first: scripted([new Error("session destroyed")], "ON_DEVICE"), retry: scripted([good], "IN_CLOUD") }, "p", image);
    expect(r).toMatchObject({ ok: true, source: "IN_CLOUD", attempts: 2 });
  });

  it("waits and tries the cloud again when Gemini is overloaded", async () => {
    const overload = new Error("This model is currently experiencing high demand.");
    const waits: number[] = [];
    const retry = scripted([overload, good], "IN_CLOUD");
    const r = await runDispatchCheck({ first: scripted([overload], "IN_CLOUD"), retry }, "p", image, async (ms) => {
      waits.push(ms);
    });
    expect(r).toMatchObject({ ok: true, source: "IN_CLOUD", attempts: 3 });
    expect(retry.calls).toBe(2);
    expect(waits).toEqual([2000, 4000]);
  });

  it("stops after one extra try when the overload lasts", async () => {
    const overload = new Error("503 UNAVAILABLE");
    const waits: number[] = [];
    const retry = scripted([overload, overload, overload], "IN_CLOUD");
    const r = await runDispatchCheck({ first: scripted([overload], "IN_CLOUD"), retry }, "p", image, async (ms) => {
      waits.push(ms);
    });
    expect(r.ok).toBe(false);
    expect(retry.calls).toBe(2);
    expect(waits).toEqual([2000, 4000]);
  });

  it("gives up after the retry and never invents a result", async () => {
    const r = await runDispatchCheck({ first: scripted(["no json here"], "ON_DEVICE"), retry: scripted([new Error("quota")], "IN_CLOUD") }, "p", image);
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.failures.map((f) => f.error)).toEqual(["invalid model output (no_json)", "quota"]);
  });
});

describe("toWireSource", () => {
  it("maps SDK values to the schema/rules values", () => {
    expect(toWireSource("on_device")).toBe("ON_DEVICE");
    expect(toWireSource("in_cloud")).toBe("IN_CLOUD");
    expect(toWireSource(undefined)).toBe("IN_CLOUD");
  });
});

describe("assessDispatch (mirrors the dispatch rule: intact seal + right code)", () => {
  const check = JSON.parse(good) as Parameters<typeof assessDispatch>[0];

  it("accepts the right code on an intact seal", () => {
    const a = assessDispatch(check, "4721");
    expect(a.accept).toBe(true);
    expect(a.problems).toEqual([]);
    expect(a.damageVisible).toBe(false);
  });
  it("rejects a wrong code, an unreadable code, and a broken seal", () => {
    expect(assessDispatch(check, "1234").problems[0]).toMatch(/shows code 4721/);
    expect(assessDispatch({ ...check, seal_code_read: "" }, "4721").accept).toBe(false);
    expect(assessDispatch({ ...check, seal_intact: false }, "4721").accept).toBe(false);
  });
  it("asks for a retake when the model itself is unsure", () => {
    const a = assessDispatch({ ...check, confidence: "low" }, "4721");
    expect(a.accept).toBe(false);
    expect(a.problems[0]).toMatch(/too unclear/);
    expect(assessDispatch({ ...check, confidence: "medium" }, "4721").accept).toBe(true);
  });
  it("records visible outside damage but flags it", () => {
    const a = assessDispatch({ ...check, spill_or_damage_visible: true }, "4721");
    expect(a.accept).toBe(true);
    expect(a.damageVisible).toBe(true);
  });
});

describe("readConfig", () => {
  const full = {
    VITE_FIREBASE_API_KEY: "k",
    VITE_FIREBASE_AUTH_DOMAIN: "p.firebaseapp.com",
    VITE_FIREBASE_PROJECT_ID: "p",
    VITE_FIREBASE_STORAGE_BUCKET: "p.firebasestorage.app",
    VITE_FIREBASE_MESSAGING_SENDER_ID: "1",
    VITE_FIREBASE_APP_ID: "1:1:web:1",
    VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: "site",
  };
  it("reads a complete config", () => {
    const r = readConfig(full, false);
    expect(r.ok && r.config.firebase.projectId).toBe("p");
  });
  it("lists what's missing", () => {
    const r = readConfig({ ...full, VITE_FIREBASE_APP_ID: " ", VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: "" }, false);
    expect(r.ok ? [] : r.missing).toEqual(["VITE_FIREBASE_APP_ID", "VITE_RECAPTCHA_ENTERPRISE_SITE_KEY"]);
  });
  it("dev may skip the reCAPTCHA key; emulators only ever in dev", () => {
    expect(readConfig({ ...full, VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: "" }, true).ok).toBe(true);
    const prod = readConfig({ ...full, VITE_USE_EMULATORS: "true" }, false);
    expect(prod.ok && prod.config.useEmulators).toBe(false);
    const dev = readConfig({ ...full, VITE_USE_EMULATORS: "true" }, true);
    expect(dev.ok && dev.config.useEmulators).toBe(true);
  });
});

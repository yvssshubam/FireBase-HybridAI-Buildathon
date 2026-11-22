// Gemini Nano (Chrome Prompt API) status for the header chip, and the user-gesture
// model download. Inference itself always goes through Firebase AI Logic; this only
// reports what the SDK will be able to use.
import type { GenerativeModel } from "firebase/ai";

export type DeviceModelState =
  | { kind: "checking" }
  | { kind: "unsupported" } // no Prompt API in this browser (not Chrome desktop 139+, or flag off)
  | { kind: "unavailable" } // API present but this device can't run Nano
  | { kind: "downloadable" }
  | { kind: "downloading"; progress: number | null }
  | { kind: "available" }
  | { kind: "error"; message: string };

// Same options the SDK passes to LanguageModel.availability() (createOptions, incl. image input).
const OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

interface LanguageModelApi {
  availability(options: object): Promise<string>;
}

function api(): LanguageModelApi | null {
  const lm: unknown = Reflect.get(globalThis, "LanguageModel");
  if ((typeof lm === "function" || typeof lm === "object") && lm !== null && typeof Reflect.get(lm, "availability") === "function") {
    return lm as LanguageModelApi;
  }
  return null;
}

let state: DeviceModelState = { kind: "checking" };
const listeners = new Set<() => void>();
const set = (s: DeviceModelState) => {
  state = s;
  for (const l of listeners) l();
};

export const deviceModelStore = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: (): DeviceModelState => state,
};

export async function refreshDeviceModel(): Promise<void> {
  const lm = api();
  if (!lm) return set({ kind: "unsupported" });
  try {
    const a = await lm.availability(OPTIONS);
    if (a === "available") set({ kind: "available" });
    else if (a === "downloading") set({ kind: "downloading", progress: state.kind === "downloading" ? state.progress : null });
    else if (a === "downloadable") set({ kind: "downloadable" });
    else set({ kind: "unavailable" });
  } catch (e) {
    set({ kind: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Must run on a user gesture (the SDK and Chrome require it for the download).
 * Never blocks inference: until the model is ready PREFER_ON_DEVICE uses the cloud.
 */
export function prepareDeviceModel(model: GenerativeModel): void {
  if (state.kind === "unsupported" || state.kind === "unavailable" || state.kind === "available") return;
  model
    .initializeDeviceModel((p) => set({ kind: "downloading", progress: p }))
    .then(refreshDeviceModel)
    .catch((e: unknown) => set({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
}

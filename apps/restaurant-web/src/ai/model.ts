// Firebase AI Logic models for DispatchCheck (PLAN §6.1).
// API shapes checked against firebase@13.4.0 typings (@firebase/ai 3.1.0) and
// firebase.google.com/docs/ai-logic/hybrid/web/* (last updated 2026-11-18).
import { getGenerativeModel, InferenceMode, InferenceSource, type AI, type GenerativeModel } from "firebase/ai";
import type { InferenceSource as WireSource } from "@fairclaim/schemas";
import { dispatchCheckSchema } from "./schema.ts";

// Pinned cloud model (also the SDK 13.x default; Gemini 2.5 models shut down in Oct 2026).
export const CLOUD_MODEL = "gemini-3.5-flash-lite";

const cloudParams = {
  model: CLOUD_MODEL,
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: dispatchCheckSchema,
    temperature: 0,
  },
};

export interface DispatchModels {
  /** PREFER_ON_DEVICE: Gemini Nano in Chrome when ready, otherwise the cloud model. */
  hybrid: GenerativeModel;
  /**
   * ONLY_IN_CLOUD, used for the single retry. Once the SDK has picked the on-device
   * model it does not fall back to the cloud on errors, so retrying in the cloud is
   * what makes the fallback dependable.
   */
  cloud: GenerativeModel;
}

let models: DispatchModels | null = null;

export function dispatchModels(ai: AI): DispatchModels {
  models ??= {
    hybrid: getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: cloudParams,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
        },
        promptOptions: { responseConstraint: dispatchCheckSchema },
      },
    }),
    cloud: getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: cloudParams }),
  };
  return models;
}

/** SDK values are "on_device" / "in_cloud"; our schemas and rules use ON_DEVICE / IN_CLOUD. */
export function toWireSource(source: string | undefined): WireSource {
  return source === InferenceSource.ON_DEVICE ? "ON_DEVICE" : "IN_CLOUD";
}

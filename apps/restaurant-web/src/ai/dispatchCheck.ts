// DispatchCheck: one call, validated with parseModelOutput; on any failure one retry
// in the cloud; then a clear error (the UI asks for a retake). Never invents data.
import { parseModelOutput, type DispatchCheck, type InferenceSource } from "@fairclaim/schemas";
import type { GenerativeModel } from "firebase/ai";
import { toWireSource, type DispatchModels } from "./model.ts";

export interface JpegImage {
  /** Base64 without the data: prefix. */
  base64: string;
}

export interface Generation {
  text: string;
  source: InferenceSource;
}

export type Generate = (prompt: string, image: JpegImage) => Promise<Generation>;

export interface AttemptLog {
  source: InferenceSource | null;
  error: string;
}

export type DispatchCheckResult =
  | { ok: true; check: DispatchCheck; source: InferenceSource; attempts: number; failures: AttemptLog[] }
  | { ok: false; failures: AttemptLog[] };

// On-device inference has no SDK timeout; don't let a stuck session hang the counter.
const ATTEMPT_TIMEOUT_MS = 90_000;
const CLOUD_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`model did not answer within ${ms / 1000} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export function generatorFor(model: GenerativeModel): Generate {
  return async (prompt, image) => {
    const result = await withTimeout(
      model.generateContent([prompt, { type: "inlineData", inlineData: { data: image.base64, mimeType: "image/jpeg" } }], {
        timeout: CLOUD_TIMEOUT_MS,
      }),
      ATTEMPT_TIMEOUT_MS,
    );
    return { text: result.response.text(), source: toWireSource(result.response.inferenceSource) };
  };
}

export function dispatchGenerators(models: DispatchModels): { first: Generate; retry: Generate } {
  return { first: generatorFor(models.hybrid), retry: generatorFor(models.cloud) };
}

export async function runDispatchCheck(
  gen: { first: Generate; retry: Generate },
  prompt: string,
  image: JpegImage,
): Promise<DispatchCheckResult> {
  const failures: AttemptLog[] = [];
  for (const [i, call] of [gen.first, gen.retry].entries()) {
    let out: Generation;
    try {
      out = await call(prompt, image);
    } catch (e) {
      failures.push({ source: null, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const parsed = parseModelOutput("dispatch", out.text);
    if (parsed.ok) return { ok: true, check: parsed.value, source: out.source, attempts: i + 1, failures };
    failures.push({ source: out.source, error: `invalid model output (${parsed.error}${parsed.detail ? `: ${parsed.detail}` : ""})` });
  }
  return { ok: false, failures };
}

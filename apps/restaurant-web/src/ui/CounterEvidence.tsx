// Flow E: answer a hold with a photo. DispatchCheck on the photo → resolveCounterEvidence()
// → preview the outcome → one batch (counterEvidence + resolutions + hold state).
import type { Policy } from "@fairclaim/schemas";
import { useEffect, useState } from "react";
import type { Services } from "../firebase/app.ts";
import { CounterError, planCounter, submitCounter, type CounterPlan } from "../data/counter.ts";
import type { CaseDocs } from "../data/engineInput.ts";
import type { DecisionView } from "../data/views.ts";
import { friendlyError } from "../errors.ts";
import { CameraView, captureAndCheck, frameFromUpload, UploadPhoto, useCamera, type CheckedPhoto, type Frame } from "./camera.tsx";
import { InferenceBadge, Notice, Spinner } from "./common.tsx";
import { reasonText, rupees } from "./format.ts";

type Step =
  | { kind: "closed" }
  | { kind: "aim" }
  | { kind: "checking" }
  | { kind: "planned"; shot: CheckedPhoto; plan: CounterPlan | null; planError: string | null }
  | { kind: "saving"; shot: CheckedPhoto; plan: CounterPlan }
  | { kind: "error"; message: string };

export function CounterEvidence({ services, uid, policy, view, docs }: { services: Services; uid: string; policy: Policy; view: DecisionView; docs: CaseDocs }) {
  const [step, setStep] = useState<Step>({ kind: "closed" });
  const camera = useCamera(services.ai);
  const shot = step.kind === "planned" || step.kind === "saving" ? step.shot : null;

  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.previewUrl);
  }, [shot]);

  async function take() {
    let frame: Frame;
    try {
      frame = camera.capture();
    } catch (e) {
      setStep({ kind: "error", message: friendlyError(e) });
      return;
    }
    await check(frame);
  }

  async function upload(file: File) {
    setStep({ kind: "checking" });
    try {
      await check(await frameFromUpload(file));
    } catch (e) {
      setStep({ kind: "error", message: friendlyError(e) });
    }
  }

  async function check(frame: Frame) {
    setStep({ kind: "checking" });
    try {
      const s = await captureAndCheck(services.ai, frame, "counter", false);
      if (!s.result.ok) {
        setStep({ kind: "planned", shot: s, plan: null, planError: null });
        return;
      }
      try {
        setStep({ kind: "planned", shot: s, plan: planCounter(docs, view.decision, policy, s.result.check), planError: null });
      } catch (e) {
        setStep({ kind: "planned", shot: s, plan: null, planError: e instanceof CounterError ? e.message : friendlyError(e) });
      }
    } catch (e) {
      setStep({ kind: "error", message: friendlyError(e) });
    }
  }

  async function submit(s: CheckedPhoto, plan: CounterPlan) {
    if (!s.result.ok) return;
    setStep({ kind: "saving", shot: s, plan });
    try {
      await submitCounter(services.db, services.storage, uid, view.decision, plan, {
        blob: s.photo.blob,
        sha256: s.photo.sha256,
        check: s.result.check,
        inferenceSource: s.result.source,
      });
      camera.stop();
      // The hold/resolution listeners now show the outcome; this panel unmounts.
    } catch (e) {
      setStep({ kind: "error", message: friendlyError(e) });
    }
  }

  if (step.kind === "closed") {
    return (
      <section className="block">
        <h3>Disagree with the split?</h3>
        <p>
          Show how this order was sealed. If the photo clearly shows the seal with code {docs.order.sealCode ?? ""} intact
          {docs.claim.issueType === "damaged" ? " and no damage on the parcel" : ""}, the hold settles by the policy. Otherwise the claim goes to a
          person for review.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setStep({ kind: "aim" })}>
          Answer with a photo
        </button>
      </section>
    );
  }

  const planned = step.kind === "planned" ? step : null;
  return (
    <section className="block counter">
      <h3>Counter-evidence photo</h3>
      <p className="muted small">The customer can see this photo. It's deleted after 3 days.</p>
      <div hidden={shot !== null}>
        <CameraView videoRef={camera.setVideo} state={camera.state} onStart={() => void camera.start()} startLabel="Open the camera" />
      </div>
      {shot && <img className="shot-preview" src={shot.previewUrl} alt="Counter-evidence photo just taken" />}
      {step.kind === "checking" && <Spinner label="Checking the photo with Gemini…" />}
      {step.kind === "saving" && <Spinner label="Recording your answer…" />}
      {step.kind === "error" && <Notice tone="error" title="That didn't work">{step.message}</Notice>}
      {planned && !planned.shot.result.ok && (
        <Notice tone="error" title="The photo couldn't be checked">
          The model gave no usable answer, even after a retry in the cloud. Retake the photo; nothing was recorded.
        </Notice>
      )}
      {planned?.planError && <Notice tone="error">{planned.planError}</Notice>}
      {planned?.shot.result.ok && planned.plan && (
        <div className="check-result">
          <div className="check-head">
            <h4>{planned.plan.resolution.outcome === "settled" ? "This settles the hold" : "This sends the claim to review"}</h4>
            <InferenceBadge source={planned.shot.result.source} />
          </div>
          <ul className="reasons">
            {planned.plan.resolution.reasons.map((r) => (
              <li key={r}>{reasonText(r)}</li>
            ))}
          </ul>
          {planned.plan.resolution.outcome === "settled" && (
            <p>
              Restaurant pays {rupees(planned.plan.resolution.liability.restaurant)}, delivery pays {rupees(planned.plan.resolution.liability.transit)}. The customer
              still gets {rupees(planned.plan.resolution.refundAmount)}.
            </p>
          )}
          <p className="muted small">
            Model read code “{planned.shot.result.check.seal_code_read || "none"}”, seal {planned.shot.result.check.seal_intact ? "intact" : "not intact"}, confidence{" "}
            {planned.shot.result.check.confidence}. This can be submitted once; retake first if the photo is unclear.
          </p>
        </div>
      )}
      <div className="actions">
        {camera.state.kind === "live" && (step.kind === "aim" || step.kind === "error") && (
          <button type="button" className="btn btn-primary" onClick={() => void take()}>
            Take photo
          </button>
        )}
        {(planned || step.kind === "error") && (
          <button type="button" className="btn" onClick={() => setStep({ kind: "aim" })}>
            Retake
          </button>
        )}
        {planned?.shot.result.ok && planned.plan && (
          <button type="button" className="btn btn-primary" onClick={() => planned.plan && void submit(planned.shot, planned.plan)}>
            Submit counter-evidence
          </button>
        )}
        <UploadPhoto onFile={(f) => void upload(f)} disabled={step.kind === "checking" || step.kind === "saving"} />
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            camera.stop();
            setStep({ kind: "closed" });
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

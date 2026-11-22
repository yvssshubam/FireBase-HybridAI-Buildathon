// Flow A: seal code → photo of the sealed parcel → DispatchCheck → one batch write.
// Seal-only: the photo proves "sealed with this order's code"; it can't see the food.
import { useEffect, useState } from "react";
import type { Services } from "../firebase/app.ts";
import { generateSealCode } from "../data/codes.ts";
import type { OrderDoc } from "../data/docs.ts";
import { assessDispatch } from "../data/dispatchAssess.ts";
import { dispatchWithoutPhoto, recordDispatch, rememberedSealCode, rememberSealCode } from "../data/orders.ts";
import { friendlyError } from "../errors.ts";
import { CameraView, captureAndCheck, frameFromUpload, UploadPhoto, useCamera, type CheckedPhoto, type Frame } from "./camera.tsx";
import { InferenceBadge, Notice, Spinner } from "./common.tsx";
import { rupees, shortId } from "./format.ts";

type Step =
  | { kind: "aim" }
  | { kind: "checking" }
  | { kind: "checked"; shot: CheckedPhoto }
  | { kind: "saving"; withPhoto: boolean }
  | { kind: "confirm-no-photo" }
  | { kind: "done"; withPhoto: boolean; note: string | null }
  | { kind: "error"; message: string };

function sealCodeFor(orderId: string): string {
  const remembered = rememberedSealCode(orderId);
  if (remembered) return remembered;
  const code = generateSealCode();
  rememberSealCode(orderId, code);
  return code;
}

export function DispatchPanel({ services, order, onClose }: { services: Services; order: OrderDoc; onClose: () => void }) {
  const [sealCode] = useState(() => sealCodeFor(order.id));
  const [step, setStep] = useState<Step>({ kind: "aim" });
  const camera = useCamera(services.ai);
  const shot = step.kind === "checked" ? step.shot : null;
  const busy = step.kind === "checking" || step.kind === "saving";

  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.previewUrl);
  }, [shot]);

  async function check(frame: Frame) {
    setStep({ kind: "checking" });
    try {
      setStep({ kind: "checked", shot: await captureAndCheck(services.ai, frame, "dispatch", true) });
    } catch (e) {
      setStep({ kind: "error", message: friendlyError(e) });
    }
  }

  function takePhoto() {
    try {
      void check(camera.capture());
    } catch (e) {
      setStep({ kind: "error", message: friendlyError(e) });
    }
  }

  async function upload(file: File) {
    setStep({ kind: "checking" });
    try {
      await check(await frameFromUpload(file));
    } catch (e) {
      setStep({ kind: "error", message: friendlyError(e) });
    }
  }

  async function save(s: CheckedPhoto) {
    if (!s.result.ok) return;
    setStep({ kind: "saving", withPhoto: true });
    try {
      const r = await recordDispatch(services.db, services.storage, order, sealCode, {
        check: s.result.check,
        inferenceSource: s.result.source,
        imageSha256: s.photo.sha256,
        capturedAt: s.photo.capturedAt,
        thumb: s.thumb ? { blob: s.thumb.blob, sha256: s.thumb.sha256 } : null,
      });
      camera.stop();
      setStep({ kind: "done", withPhoto: true, note: r.thumbStored ? null : `Thumbnail not stored (${r.thumbError ?? "skipped"}); the evidence itself is saved.` });
    } catch (e) {
      setStep({ kind: "error", message: friendlyError(e) });
    }
  }

  async function saveWithoutPhoto() {
    setStep({ kind: "saving", withPhoto: false });
    try {
      await dispatchWithoutPhoto(services.db, order, sealCode);
      camera.stop();
      setStep({ kind: "done", withPhoto: false, note: null });
    } catch (e) {
      setStep({ kind: "error", message: friendlyError(e) });
    }
  }

  const assessment = shot?.result.ok ? assessDispatch(shot.result.check, sealCode) : null;

  return (
    <section className="panel dispatch" aria-labelledby="dispatch-title">
      <header className="panel-head">
        <div>
          <h2 id="dispatch-title">Dispatch order #{shortId(order.id)}</h2>
          <p className="muted">
            {order.items.map((i) => i.name).join(", ")} · {rupees(order.total)}
          </p>
        </div>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Close
        </button>
      </header>

      {step.kind === "done" ? (
        <Notice tone="ok" title={step.withPhoto ? "Dispatch recorded" : "Dispatched without a photo"}>
          {step.withPhoto
            ? `The parcel is on record as sealed with code ${sealCode}. If the seal is still intact at handoff, nobody opened it on the way.`
            : "Any claim on this order will go on hold, because there's no dispatch photo to check it against."}
          {step.note && <p className="muted">{step.note}</p>}
        </Notice>
      ) : (
        <div className="dispatch-body">
          <div className="dispatch-side">
            <div className="seal-sticker" aria-label={`Seal code ${sealCode.split("").join(" ")}`}>
              <span className="seal-label">Write on the seal sticker</span>
              <span className="seal-code">{sealCode}</span>
            </div>
            <ol className="steps">
              <li>Pack the order and close the bag with a sticker across the opening.</li>
              <li>Write {sealCode} on the sticker, large and dark.</li>
              <li>Photograph the sealed bag so the whole sticker is in frame.</li>
            </ol>

            {step.kind === "error" && <Notice tone="error" title="That didn't work">{step.message}</Notice>}
            {shot && !shot.result.ok && (
              <Notice tone="error" title="The photo couldn't be checked">
                The model gave no usable answer, even after a retry in the cloud. Retake the photo; nothing was recorded.
                <ul className="small">
                  {shot.result.failures.map((f, i) => (
                    <li key={i}>
                      Attempt {i + 1}
                      {f.source ? ` (${f.source})` : ""}: {f.error}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {shot?.result.ok && assessment && (
              <div className={assessment.accept ? "check-result check-pass" : "check-result check-fail"}>
                <div className="check-head">
                  <h3>{assessment.accept ? "Seal and code confirmed" : "Retake needed"}</h3>
                  <InferenceBadge source={shot.result.source} />
                </div>
                {assessment.problems.length > 0 && (
                  <ul className="problems">
                    {assessment.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                <p className="muted small">
                  Read code “{shot.result.check.seal_code_read || "none"}”, seal {shot.result.check.seal_intact ? "intact" : "not intact"}, confidence{" "}
                  {shot.result.check.confidence}.
                </p>
                {assessment.accept && assessment.damageVisible && (
                  <p className="warn-line">The parcel looks damaged or leaking. A damage claim on this order would be the restaurant's, so repack if you can.</p>
                )}
              </div>
            )}

            <div className="actions">
              {camera.state.kind === "live" && !shot && !busy && (
                <button type="button" className="btn btn-primary" onClick={takePhoto}>
                  Take photo
                </button>
              )}
              {(shot || step.kind === "error") && (
                <button type="button" className="btn" onClick={() => setStep({ kind: "aim" })}>
                  Retake
                </button>
              )}
              {shot?.result.ok && assessment?.accept && (
                <button type="button" className="btn btn-primary" onClick={() => void save(shot)}>
                  Record dispatch
                </button>
              )}
            </div>
            <UploadPhoto onFile={(f) => void upload(f)} disabled={busy} />

            {step.kind === "confirm-no-photo" ? (
              <Notice tone="warn" title="Dispatch without a photo?">
                Without dispatch evidence, every claim on this order goes on hold and the restaurant shares the cost.
                <div className="actions">
                  <button type="button" className="btn btn-danger" onClick={() => void saveWithoutPhoto()}>
                    Dispatch without photo
                  </button>
                  <button type="button" className="btn" onClick={() => setStep({ kind: "aim" })}>
                    Keep the photo step
                  </button>
                </div>
              </Notice>
            ) : (
              !busy && (
                <button type="button" className="btn btn-link" onClick={() => setStep({ kind: "confirm-no-photo" })}>
                  Dispatch without photo
                </button>
              )
            )}
          </div>

          <div className="dispatch-view">
            {/* Kept mounted (only hidden) so the live stream survives a retake. */}
            <div className="dispatch-camera" hidden={shot !== null}>
              <CameraView videoRef={camera.setVideo} state={camera.state} onStart={() => void camera.start()} startLabel="Open the camera" />
            </div>
            {shot && <img className="shot-preview" src={shot.previewUrl} alt="Dispatch photo just checked" />}
            {step.kind === "checking" && <Spinner label="Checking the seal with Gemini…" />}
            {step.kind === "saving" && <Spinner label="Recording the dispatch…" />}
          </div>
        </div>
      )}
    </section>
  );
}

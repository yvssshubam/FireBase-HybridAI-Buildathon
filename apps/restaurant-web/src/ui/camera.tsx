import type { AI } from "firebase/ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildDispatchPrompt, type CheckPurpose } from "../ai/prompt.ts";
import { dispatchGenerators, runDispatchCheck, type DispatchCheckResult } from "../ai/dispatchCheck.ts";
import { dispatchModels } from "../ai/model.ts";
import { prepareDeviceModel } from "../ai/deviceModel.ts";
import { PHOTO_UPLOAD_ENABLED } from "../flags.ts";
import {
  CameraError,
  encodeUnder,
  frameFromFile,
  grabFrame,
  openCamera,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_SIDE,
  shrinkTo,
  stopCamera,
  THUMB_MAX_BYTES,
  THUMB_MAX_SIDE,
  type CapturedJpeg,
} from "../capture/camera.ts";

/** A photo ready to check: from the live camera, or (demo builds) an uploaded file. */
export interface Frame {
  canvas: HTMLCanvasElement;
  /** Camera: shutter time. Upload: the file's last-modified time. */
  capturedAt: number;
}

export async function frameFromUpload(file: File): Promise<Frame> {
  return { canvas: await frameFromFile(file, PHOTO_MAX_SIDE), capturedAt: file.lastModified || Date.now() };
}

export type CameraState = { kind: "off" } | { kind: "starting" } | { kind: "live" } | { kind: "error"; message: string };

export function useCamera(ai: AI) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>({ kind: "off" });
  const setVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
  }, []);

  const stop = useCallback(() => {
    stopCamera(streamRef.current);
    streamRef.current = null;
    setState({ kind: "off" });
  }, []);

  // Called from a click: that user gesture also lets Chrome download Gemini Nano.
  const start = useCallback(async () => {
    prepareDeviceModel(dispatchModels(ai).hybrid);
    setState({ kind: "starting" });
    try {
      const stream = await openCamera();
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => undefined);
      }
      setState({ kind: "live" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof CameraError ? e.message : String(e) });
    }
  }, [ai]);

  useEffect(() => () => stopCamera(streamRef.current), []);

  const capture = useCallback((): Frame => {
    const v = videoRef.current;
    if (!v) throw new CameraError("The camera isn't open.");
    return { canvas: grabFrame(v, PHOTO_MAX_SIDE), capturedAt: Date.now() };
  }, []);

  return { setVideo, state, start, stop, capture };
}

export function CameraView({
  videoRef,
  state,
  onStart,
  startLabel,
}: {
  videoRef: (el: HTMLVideoElement | null) => void;
  state: CameraState;
  onStart: () => void;
  startLabel: string;
}) {
  return (
    <div className="camera">
      <video ref={videoRef} className={state.kind === "live" ? "camera-video" : "camera-video camera-hidden"} muted playsInline />
      {state.kind !== "live" && (
        <div className="camera-placeholder">
          {state.kind === "error" && <p className="camera-error">{state.message}</p>}
          <button type="button" className="btn btn-primary" onClick={onStart} disabled={state.kind === "starting"}>
            {state.kind === "starting" ? "Opening camera…" : state.kind === "error" ? "Try the camera again" : startLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export interface CheckedPhoto {
  photo: CapturedJpeg;
  thumb: CapturedJpeg | null;
  previewUrl: string;
  result: DispatchCheckResult;
}

/** Frame → JPEG (+ thumbnail) → DispatchCheck through Firebase AI Logic. */
export async function captureAndCheck(ai: AI, frame: Frame, purpose: CheckPurpose, withThumb: boolean): Promise<CheckedPhoto> {
  const photo = await encodeUnder(frame.canvas, PHOTO_MAX_BYTES, frame.capturedAt);
  const thumb = withThumb ? await encodeUnder(shrinkTo(frame.canvas, THUMB_MAX_SIDE), THUMB_MAX_BYTES, frame.capturedAt) : null;
  const result = await runDispatchCheck(dispatchGenerators(dispatchModels(ai)), buildDispatchPrompt(purpose), { base64: photo.base64 });
  return { photo, thumb, previewUrl: URL.createObjectURL(photo.blob), result };
}

/**
 * Demo-only path: lets judges and testers without a sealed parcel or a webcam use a
 * photo file. The photo goes through exactly the same Gemini check. Off when
 * VITE_ALLOW_PHOTO_UPLOAD=false, because a real restaurant could reuse an old photo.
 */
export function UploadPhoto({ onFile, disabled }: { onFile: (file: File) => void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  if (!PHOTO_UPLOAD_ENABLED) return null;
  return (
    <div className="upload">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) onFile(f);
        }}
      />
      <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Upload a photo
      </button>
      <span className="upload-note">For the demo</span>
    </div>
  );
}

import type { InferenceSource } from "@fairclaim/schemas";
import type { FirebaseStorage } from "firebase/storage";
import { useEffect, useState, type ReactNode } from "react";
import { friendlyError } from "../errors.ts";
import { loadImage } from "../data/images.ts";
import { useDemo } from "../demo/context.ts";

/** Shown on every AI result: where the model actually ran (PLAN §6.4). */
export function InferenceBadge({ source }: { source: InferenceSource }) {
  const onDevice = source === "ON_DEVICE";
  return (
    <span className={`badge ${onDevice ? "badge-device" : "badge-cloud"}`} title={onDevice ? "Gemini Nano in this browser" : "Gemini in the cloud via Firebase AI Logic"}>
      {onDevice ? "ON_DEVICE" : "IN_CLOUD"}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Notice({ tone, title, children }: { tone: "error" | "warn" | "ok" | "info"; title?: string; children?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : undefined}>
      {title && <strong>{title}</strong>}
      {children && <div>{children}</div>}
    </div>
  );
}

type ImageState = { path: string; url: string } | { path: string; error: string } | null;

/** Evidence image from Storage, shown via a blob: URL. */
export function StoredImage({ storage, path, alt }: { storage: FirebaseStorage; path: string; alt: string }) {
  const [state, setState] = useState<ImageState>(null);
  const demo = useDemo() !== null && path.startsWith("demo/");
  useEffect(() => {
    if (demo) return;
    let live = true;
    loadImage(storage, path).then(
      (img) => live && setState({ path, url: img.url }),
      (e: unknown) => live && setState({ path, error: friendlyError(e) }),
    );
    return () => {
      live = false;
    };
  }, [demo, storage, path]);
  if (demo) return <div className="image-frame image-missing">Sample claim (no photo in demo data)</div>;
  const current = state?.path === path ? state : null;
  if (!current) return <div className="image-frame image-loading">Loading image…</div>;
  if ("error" in current) return <div className="image-frame image-missing">Image unavailable: {current.error}</div>;
  return <img className="image-frame" src={current.url} alt={alt} />;
}

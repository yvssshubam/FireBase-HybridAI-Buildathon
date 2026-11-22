// "Connect a phone": the QR code the customer's FairClaim app scans to order from
// this restaurant. The typed code stays as a small fallback (and for dev/customer-sim).
import { useEffect, useMemo, useRef } from "react";
import { pairPayload, qrMatrix } from "../data/pairing.ts";

const QUIET = 4; // modules of white border the QR spec requires

function QrSvg({ text }: { text: string }) {
  const { d, size } = useMemo(() => {
    const m = qrMatrix(text);
    let path = "";
    m.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (dark) path += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
      }),
    );
    return { d: path, size: m.length + QUIET * 2 };
  }, [text]);
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code to connect the FairClaim app" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#16202b" />
    </svg>
  );
}

export function ConnectPhoneDialog({ pairCode, onClose }: { pairCode: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title" tabIndex={-1}>
        <h2 id="connect-title">Connect a customer's phone</h2>
        <p className="muted">Orders from that phone come to this restaurant. Each phone only needs to do this once.</p>
        <QrSvg text={pairPayload(pairCode)} />
        <ol className="steps">
          <li>Open the FairClaim app on the phone.</li>
          <li>Tap “Scan restaurant code” and point the camera at this QR.</li>
          <li>Place an order. It appears on the Orders page here.</li>
        </ol>
        <p className="small muted">
          Can't scan? Type <strong className="code-inline">{pairCode}</strong> in the app instead.
        </p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

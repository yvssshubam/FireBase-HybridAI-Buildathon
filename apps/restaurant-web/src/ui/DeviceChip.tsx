import { useDeviceModel } from "./hooks.ts";

const TEXT = {
  checking: ["Checking Gemini Nano…", "Looking for Chrome's built-in model"],
  unsupported: ["Cloud checks", "This browser has no built-in model; photos are checked by Gemini in the cloud"],
  unavailable: ["Cloud checks", "Gemini Nano can't run on this computer; photos are checked by Gemini in the cloud"],
  downloadable: ["Nano ready to download", "Gemini Nano downloads the first time you open the camera; until then checks run in the cloud"],
  available: ["On-device ready", "Photos are checked by Gemini Nano in this browser"],
} as const;

export function DeviceChip() {
  const s = useDeviceModel();
  if (s.kind === "downloading") {
    const pct = s.progress === null ? "" : ` ${Math.round(s.progress * 100)}%`;
    return (
      <span className="chip" title="Checks run in the cloud until the download finishes">
        Downloading Nano{pct}
      </span>
    );
  }
  if (s.kind === "error") {
    return (
      <span className="chip chip-warn" title={s.message}>
        Cloud checks
      </span>
    );
  }
  const [label, title] = TEXT[s.kind];
  return (
    <span className={s.kind === "available" ? "chip chip-device" : "chip"} title={title}>
      {label}
    </span>
  );
}

// Hold window: holds/{id}.createdAt (server time) + holdHours (Decisions: replaces holdUntil).
// The rules compare against request.time, so the local clock only decides what to show
// and when to *try* settling; a write too early is rejected and retried later.

const HOUR_MS = 3_600_000;

export function holdEndsAt(createdAt: number, holdHours: number): number {
  return createdAt + holdHours * HOUR_MS;
}

export function remainingMs(createdAt: number, holdHours: number, now: number): number {
  return Math.max(0, holdEndsAt(createdAt, holdHours) - now);
}

export function isExpired(createdAt: number, holdHours: number, now: number): boolean {
  return now >= holdEndsAt(createdAt, holdHours);
}

/** "47 h 59 min", "59 min 05 s", "Expired". */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${m} min ${String(s).padStart(2, "0")} s`;
}

/** A hold can be settled once its window has passed and nobody has answered it. */
export function shouldSettle(hold: { state: string; createdAt: number | null; holdHours: number }, now: number): boolean {
  return hold.state === "held" && hold.createdAt !== null && isExpired(hold.createdAt, hold.holdHours, now);
}

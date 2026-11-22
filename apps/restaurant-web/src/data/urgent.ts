// Overview: what needs the restaurant right now, most urgent first.
// 1. Holds that settle on their own within 6 h (answer now or the split stands).
// 2. Orders waiting to be packed (a customer is waiting).
// 3. Decisions that failed the replay re-check (a red flag to look at).
// 4. Other open holds, by deadline.
// Claims under review are left out: a FairClaim reviewer decides those, not the restaurant.
import type { OrderDoc } from "./docs.ts";
import type { ActionItem } from "./stats.ts";
import type { DecisionView } from "./views.ts";

export const SOON_MS = 6 * 3_600_000;

export type UrgentItem =
  | { kind: "hold_soon"; view: DecisionView; deadline: number }
  | { kind: "pack"; order: OrderDoc }
  | { kind: "mismatch"; view: DecisionView }
  | { kind: "hold"; view: DecisionView; deadline: number };

export function urgentItems(
  respond: readonly ActionItem[],
  views: readonly DecisionView[],
  orders: readonly OrderDoc[],
  now: number,
): UrgentItem[] {
  const holds = respond.flatMap((i) => (i.kind === "respond" ? [{ view: i.view, deadline: i.deadline }] : [])).sort((a, b) => a.deadline - b.deadline);
  const soon = holds.filter((h) => h.deadline - now < SOON_MS);
  const later = holds.filter((h) => h.deadline - now >= SOON_MS);
  const pack = orders.filter((o) => o.status === "placed").sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const mismatch = views
    .filter((v) => v.audit?.match === false)
    .sort((a, b) => (b.audit?.auditedAt ?? 0) - (a.audit?.auditedAt ?? 0));
  return [
    ...soon.map((h) => ({ kind: "hold_soon" as const, ...h })),
    ...pack.map((order) => ({ kind: "pack" as const, order })),
    ...mismatch.map((view) => ({ kind: "mismatch" as const, view })),
    ...later.map((h) => ({ kind: "hold" as const, ...h })),
  ];
}

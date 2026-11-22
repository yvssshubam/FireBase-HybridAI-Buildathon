// Owner analytics for a period: claims per day, claim rate, money, failed checks,
// most-claimed items. Built on computeStats() so every total matches the rest of
// the console; nothing here is a model output.
import type { ClaimDoc, OrderDoc } from "./docs.ts";
import { computeStats, fraudSignalsOf, outcomeOf, type DashboardStats, type Outcome } from "./stats.ts";
import type { DecisionView } from "./views.ts";

export const PERIODS = [7, 14] as const;
export type PeriodDays = (typeof PERIODS)[number];

export interface DayBucket {
  /** Local midnight that starts the day. */
  start: number;
  refunded: number;
  pending: number;
  review: number;
}

export interface ItemCount {
  name: string;
  claims: number;
  refunded: number;
}

export interface Analytics {
  from: number;
  days: DayBucket[];
  stats: DashboardStats;
  /** Orders placed in the period (the claim-rate denominator). */
  orders: number;
  /** Claims that failed an anti-fraud check and were not paid out. */
  blocked: { claims: number; amount: number };
  topItems: ItemCount[];
}

const DAY = 86_400_000;

/** Local midnight of `t` (shifts with DST like a wall clock, which is what a person reads). */
export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local midnights of the last `days` days, oldest first, ending with today. */
export function dayStarts(now: number, days: number): number[] {
  const out: number[] = [];
  let d = startOfDay(now);
  for (let i = 0; i < days; i++) {
    out.unshift(d);
    // Step back from noon so a 23- or 25-hour DST day still lands on the previous date.
    d = startOfDay(d - DAY / 2);
  }
  return out;
}

export function analytics(
  views: readonly DecisionView[],
  orders: readonly OrderDoc[],
  claims: ReadonlyMap<string, ClaimDoc>,
  now: number,
  periodDays: number,
): Analytics {
  const starts = dayStarts(now, periodDays);
  const from = starts[0] ?? startOfDay(now);
  const inPeriod = views.filter((v) => v.decision.createdAt !== null && v.decision.createdAt >= from && v.decision.createdAt <= now);
  const orderMap = new Map(orders.map((o) => [o.id, o]));

  const days: DayBucket[] = starts.map((start) => ({ start, refunded: 0, pending: 0, review: 0 }));
  const blocked = { claims: 0, amount: 0 };
  const items = new Map<string, ItemCount>();
  for (const v of inPeriod) {
    const created = v.decision.createdAt ?? from;
    const bucket = days[bucketIndex(starts, created)];
    const outcome: Outcome = outcomeOf(v);
    if (bucket) bucket[outcome]++;
    if (fraudSignalsOf(v).length > 0 && v.decision.refundAmount === 0) {
      blocked.claims++;
      blocked.amount += v.decision.assessedAmount;
    }
    const order = orderMap.get(v.decision.orderId);
    const claim = claims.get(v.decision.claimId);
    if (order && claim) {
      const ids = new Set(claim.selectedItemIds);
      for (const id of ids) {
        const name = order.items.find((i) => i.id === id)?.name;
        if (!name) continue;
        const c = items.get(name) ?? { name, claims: 0, refunded: 0 };
        c.claims++;
        // A multi-item claim's refund is shared evenly for this ranking only.
        if (outcome === "refunded") c.refunded += Math.round(v.decision.refundAmount / ids.size);
        items.set(name, c);
      }
    }
  }

  return {
    from,
    days,
    stats: computeStats(inPeriod, orderMap, claims),
    orders: orders.filter((o) => o.createdAt !== null && o.createdAt >= from && o.createdAt <= now).length,
    blocked,
    topItems: [...items.values()].sort((a, b) => b.claims - a.claims || b.refunded - a.refunded || a.name.localeCompare(b.name)).slice(0, 5),
  };
}

function bucketIndex(starts: readonly number[], t: number): number {
  for (let i = starts.length - 1; i >= 0; i--) if (t >= (starts[i] ?? 0)) return i;
  return 0;
}

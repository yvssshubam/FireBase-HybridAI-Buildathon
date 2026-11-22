// Overview: the period's numbers (claims, refunds, failed fraud checks) and the cases
// that need the restaurant right now, on one laptop screen. Every number comes from
// analytics() over stored decisions; the case list from urgentItems().
import { PERIODS, type Analytics, type PeriodDays } from "../data/analytics.ts";
import { formatRemaining } from "../data/hold.ts";
import type { ActionItem } from "../data/stats.ts";
import { SOON_MS, type UrgentItem } from "../data/urgent.ts";
import { Legend, SegmentedBar } from "./charts.tsx";
import { Notice, Spinner } from "./common.tsx";
import { caseText, customerLabel, mismatchText, percent, rupees, rupeesCompact, shortId, when } from "./format.ts";
import { claimHref, Link, orderHref, PAGE_PATH } from "./router.tsx";
import { PageHeader } from "./Shell.tsx";

const shortDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

export function Overview({
  data,
  period,
  onPeriod,
  queue,
  urgent,
  now,
  loadError,
}: {
  data: Analytics | null;
  period: PeriodDays;
  onPeriod: (p: PeriodDays) => void;
  queue: { respond: ActionItem[]; review: ActionItem[] };
  urgent: UrgentItem[] | null;
  now: number;
  loadError: string | null;
}) {
  const periodPicker = (
    <div className="chips" role="group" aria-label="Period">
      {PERIODS.map((p) => (
        <button key={p} type="button" className={p === period ? "chip-btn chip-on" : "chip-btn"} aria-pressed={p === period} onClick={() => onPeriod(p)}>
          Last {p} days
        </button>
      ))}
    </div>
  );
  return (
    <div className="page-fill">
      <PageHeader title="Overview" lead={data ? `Refund claims since ${shortDate.format(data.from)}` : "Refund claims on your orders"} aside={periodPicker} />
      {loadError && <Notice tone="error" title="Claims couldn't load">{loadError}</Notice>}
      {!data || !urgent ? <Spinner label="Loading claims…" /> : <Dashboard a={data} queue={queue} urgent={urgent} now={now} />}
    </div>
  );
}

function Dashboard({ a, queue, urgent, now }: { a: Analytics; queue: { respond: ActionItem[]; review: ActionItem[] }; urgent: UrgentItem[]; now: number }) {
  const s = a.stats;
  const next = queue.respond[0];
  const nextLeft = next?.kind === "respond" ? next.deadline - now : null;
  const nextText = nextLeft === null ? "" : nextLeft >= 3_600_000 ? `${Math.floor(nextLeft / 3_600_000)} h` : formatRemaining(nextLeft);
  const soon = queue.respond.filter((i) => i.kind === "respond" && i.deadline - now < 6 * 3_600_000).length;
  const paidTotal = s.paidBy.restaurant + s.paidBy.transit + s.paidBy.platform;
  const aiTotal = s.inference.onDevice + s.inference.inCloud;

  return (
    <div className="dash">
      <section className="tile tile-hero" aria-label="Refunded">
        <span className="tile-label">Refunded to customers</span>
        <span className="hero-figure">{rupeesCompact(s.refundedAmount)}</span>
        <span className="tile-note">
          {s.refunded} of {s.filed} claim{s.filed === 1 ? "" : "s"} refunded
          {s.savedAmount > 0 && (
            <>
              {" "}
              · <b>{rupeesCompact(s.savedAmount)}</b> less than refunding whole orders
            </>
          )}
        </span>
      </section>

      <section className="tile" aria-label="Claims filed">
        <span className="tile-label">Claims filed</span>
        <span className="tile-figure">{s.filed}</span>
        <span className="tile-note">{a.orders > 0 ? `${percent(s.filed, a.orders)} of ${a.orders} orders` : "no orders in this period"}</span>
      </section>

      <section className="tile" aria-label="Failed fraud checks">
        <span className="tile-label">Failed fraud checks</span>
        <span className="tile-figure">{a.blocked.claims}</span>
        <span className="tile-note">{a.blocked.claims > 0 ? `${rupees(a.blocked.amount)} not paid out` : "every claim passed"}</span>
      </section>

      <Link to={PAGE_PATH.action} className={queue.respond.length > 0 ? "tile tile-link tile-yours" : "tile tile-link"}>
        <span className="tile-label">Waiting for you</span>
        <span className="tile-figure">{queue.respond.length}</span>
        <span className="tile-note">
          {nextLeft !== null ? `next settles in ${nextText}${soon > 1 ? `, ${soon} soon` : ""}` : "nothing to answer"}
        </span>
      </Link>

      <section className="card card-urgent" aria-labelledby="urgent-h">
        <header className="card-head">
          <h2 id="urgent-h">Needs you now</h2>
          <span className="muted small">
            {urgent.length === 0 ? "all clear" : `${urgent.length} case${urgent.length === 1 ? "" : "s"}, most urgent first`}
            {queue.review.length > 0 && (
              <>
                {" · "}
                <Link to={PAGE_PATH.action}>{queue.review.length} under review</Link> (FairClaim decides)
              </>
            )}
          </span>
        </header>
        {urgent.length === 0 ? (
          <p className="empty-hint">Nothing needs you right now. Orders to pack, holds about to settle and decisions that fail the re-check show up here the moment they come in.</p>
        ) : (
          <ul className="queue-list urgent-list">
            {urgent.map((i) => (
              <UrgentRow key={i.kind === "pack" ? `pack-${i.order.id}` : `${i.kind}-${i.view.decision.claimId}`} item={i} now={now} />
            ))}
          </ul>
        )}
      </section>

      <section className="card card-paid" aria-labelledby="paid-h">
        <header className="card-head">
          <h2 id="paid-h">Who paid the refunds</h2>
        </header>
        {paidTotal === 0 ? (
          <EmptyHint text="No refunds paid in this period." />
        ) : (
          <div className="paid">
            <SegmentedBar
              label="Who paid the refunds"
              parts={[
                { label: "Your restaurant", value: s.paidBy.restaurant, color: "var(--viz-restaurant)" },
                { label: "Delivery partner", value: s.paidBy.transit, color: "var(--viz-delivery)" },
                { label: "Platform", value: s.paidBy.platform, color: "var(--viz-platform)", ink: "dark" },
              ]}
            />
            <dl className="paid-list">
              <PaidRow label="Your restaurant" color="var(--viz-restaurant)" value={s.paidBy.restaurant} total={paidTotal} />
              <PaidRow label="Delivery partner" color="var(--viz-delivery)" value={s.paidBy.transit} total={paidTotal} />
              {s.paidBy.platform > 0 && <PaidRow label="Platform" color="var(--viz-platform)" value={s.paidBy.platform} total={paidTotal} />}
            </dl>
            <p className="card-foot">
              Decided from the seal at dispatch and at handoff. {s.pending > 0 && `${rupees(s.pendingAmount)} is still on hold.`}
            </p>
          </div>
        )}
      </section>

      <section className="card card-ai" aria-labelledby="ai-h">
        <header className="card-head">
          <h2 id="ai-h">Where Gemini ran</h2>
        </header>
        {aiTotal === 0 ? (
          <EmptyHint text="No photo checks in this period yet." />
        ) : (
          <>
            <span className="ai-figure">{percent(s.inference.onDevice, aiTotal)}</span>
            <span className="ai-sub">of {aiTotal} customer photo checks ran on the phone</span>
            <SegmentedBar
              thin
              label="Photo checks by where they ran"
              parts={[
                { label: "On the phone (Gemini Nano)", value: s.inference.onDevice, color: "var(--viz-device)" },
                { label: "In the cloud", value: s.inference.inCloud, color: "var(--viz-cloud)" },
              ]}
            />
            <Legend
              items={[
                { label: "On the phone", color: "var(--viz-device)", value: s.inference.onDevice },
                { label: "Cloud", color: "var(--viz-cloud)", value: s.inference.inCloud },
              ]}
            />
          </>
        )}
      </section>
    </div>
  );
}

function PaidRow({ label, color, value, total }: { label: string; color: string; value: number; total: number }) {
  return (
    <div>
      <dt>
        <span className="key" style={{ background: color }} aria-hidden="true" />
        {label}
      </dt>
      <dd>
        {rupees(value)} <span className="muted">{percent(value, total)}</span>
      </dd>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="empty-hint">{text}</p>;
}

function UrgentRow({ item, now }: { item: UrgentItem; now: number }) {
  switch (item.kind) {
    case "hold_soon":
    case "hold": {
      const d = item.view.decision;
      const left = item.deadline - now;
      return (
        <li>
          <Link to={claimHref("overview", d.claimId)} className={`queue-row urgent-row ${left < SOON_MS ? "row-critical" : "row-yours"}`}>
            <span className={left < SOON_MS ? "who who-critical" : "who who-yours"}>{left < SOON_MS ? "Settles soon" : "Answer hold"}</span>
            <span className="queue-main">
              <strong>
                Order #{shortId(d.orderId)} · {customerLabel(d.customerId)}
              </strong>
              <span className="muted">{caseText(d.liabilityCase)}</span>
              <span className="queue-do">Accept the split, or answer with a photo. If you do nothing, you pay {rupees(d.liability.restaurant)}.</span>
            </span>
            <span className="queue-money">
              <span>{rupees(d.refundAmount)} held</span>
              <span className="muted">you'd pay {rupees(d.liability.restaurant)}</span>
            </span>
            <span className={left < SOON_MS ? "clock clock-soon" : "clock"}>
              <b>{formatRemaining(left)}</b>
              <span>left</span>
            </span>
            <span className="queue-go">Answer</span>
          </Link>
        </li>
      );
    }
    case "pack": {
      const o = item.order;
      return (
        <li>
          <Link to={orderHref(o.id)} className="queue-row urgent-row row-yours">
            <span className="who who-yours">Pack order</span>
            <span className="queue-main">
              <strong>Order #{shortId(o.id)}</strong>
              <span className="muted">{o.items.map((i) => i.name).join(", ")}</span>
              <span className="queue-do">Seal it with its code and take the dispatch photo before it leaves.</span>
            </span>
            <span className="queue-money">
              <span>{rupees(o.total)}</span>
              <span className="muted">{o.items.length} item{o.items.length === 1 ? "" : "s"}</span>
            </span>
            <span className="clock clock-idle">
              <b>{when(o.createdAt)}</b>
              <span>placed</span>
            </span>
            <span className="queue-go">Pack</span>
          </Link>
        </li>
      );
    }
    case "mismatch": {
      const v = item.view;
      const d = v.decision;
      return (
        <li>
          <Link to={claimHref("overview", d.claimId)} className="queue-row urgent-row row-critical">
            <span className="who who-critical">Re-check failed</span>
            <span className="queue-main">
              <strong>
                Order #{shortId(d.orderId)} · {customerLabel(d.customerId)}
              </strong>
              <span className="alert-text">Re-running the rules on the stored evidence changes {mismatchText(v.audit?.mismatchFields ?? [])}.</span>
              <span className="queue-do">The decision written by the customer's app doesn't match its own evidence. Open it to see what differs.</span>
            </span>
            <span className="queue-money">
              <span>{rupees(d.refundAmount)} refunded</span>
              <span className="muted">charged to you {rupees(d.liability.restaurant)}</span>
            </span>
            <span className="clock clock-idle">
              <b>{when(v.audit?.auditedAt ?? d.createdAt)}</b>
              <span>checked</span>
            </span>
            <span className="queue-go">Open</span>
          </Link>
        </li>
      );
    }
  }
}

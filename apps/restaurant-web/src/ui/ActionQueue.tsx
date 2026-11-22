// Needs action. Two different kinds of work, filtered with chips:
// - "Your move": open holds. The restaurant can accept the split or send a photo
//   before the deadline; after it, the split settles on its own.
// - "Under review": claims a FairClaim reviewer decides. Nothing for the
//   restaurant to do; they are listed so the owner can see what's pending.
import { useState } from "react";
import { formatRemaining } from "../data/hold.ts";
import type { ActionItem } from "../data/stats.ts";
import { fraudSignalsOf } from "../data/stats.ts";
import type { DecisionView } from "../data/views.ts";
import { Notice, Spinner } from "./common.tsx";
import { caseText, customerLabel, mismatchText, rupees, shortId, SIGNAL_LABEL, when } from "./format.ts";
import { claimHref, Link } from "./router.tsx";
import { PageHeader } from "./Shell.tsx";

type Filter = "all" | "yours" | "review" | "soon";
const SOON_MS = 6 * 3_600_000;

function reviewReason(v: DecisionView): string {
  if (v.reviewBecause.includes("audit_mismatch")) return `Decision mismatch: re-running the rules on the stored evidence changes ${mismatchText(v.audit?.mismatchFields ?? [])}`;
  if (v.reviewBecause.includes("escalated")) return "Your counter-evidence wasn't clear enough to settle it";
  const signals = fraudSignalsOf(v);
  if (signals.length > 0) return `Failed fraud check: ${signals.map((s) => SIGNAL_LABEL[s] ?? s).join("; ")}`;
  if (v.decision.reasons.includes("claim_history_limit")) return "Customer has made too many claims this month for an instant refund";
  if (v.decision.reasons.includes("over_auto_approve_cap")) return "Refund is above the instant-refund limit";
  return "The evidence didn't verify (unclear photo or flagged by the review)";
}

export function ActionQueue({
  queue,
  loading,
  loadError,
  now,
}: {
  queue: { respond: ActionItem[]; review: ActionItem[] };
  loading: boolean;
  loadError: string | null;
  now: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const soon = queue.respond.filter((i) => i.kind === "respond" && i.deadline - now < SOON_MS);
  const lists: Record<Filter, ActionItem[]> = {
    all: [...queue.respond, ...queue.review],
    yours: queue.respond,
    review: queue.review,
    soon,
  };
  const chips: { id: Filter; label: string; hint: string }[] = [
    { id: "all", label: "All", hint: "Everything open" },
    { id: "yours", label: "Your move", hint: "Holds you can accept or answer with a photo" },
    { id: "soon", label: "Settling soon", hint: "Holds that settle on their own within 6 hours" },
    { id: "review", label: "Under review", hint: "A FairClaim reviewer decides; nothing for you to do" },
  ];
  const shown = lists[filter];

  return (
    <div className="page-fill">
      <PageHeader title="Needs action" lead="Answer holds before their deadline. Reviews are FairClaim's call; you only watch them." />
      {loadError && <Notice tone="error" title="Claims couldn't load">{loadError}</Notice>}
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.hint}
              className={`chip-btn chip-${c.id}${filter === c.id ? " chip-on" : ""}`}
              aria-pressed={filter === c.id}
              onClick={() => setFilter(c.id)}
            >
              {c.label} <span className="chip-count">{lists[c.id].length}</span>
            </button>
          ))}
        </div>
        <p className="toolbar-hint">{chips.find((c) => c.id === filter)?.hint}</p>
      </div>

      {loading ? (
        <Spinner label="Loading claims…" />
      ) : (
        <section className="card card-scroll" aria-label="Open claims">
          {shown.length === 0 ? (
            <p className="empty-hint">{EMPTY[filter]}</p>
          ) : (
            <ul className="queue-list">
              {shown.map((i) => (i.kind === "respond" ? <YourMove key={i.view.decision.claimId} item={i} now={now} /> : <UnderReview key={i.view.decision.claimId} item={i} />))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

const EMPTY: Record<Filter, string> = {
  all: "Nothing is open. Unclear claims are held here for you to answer, and claims that fail the checks wait here for a reviewer.",
  yours: "No open holds. When it's unclear who's responsible, the claim is held here so you can accept the split or answer with a photo.",
  soon: "No hold settles in the next 6 hours.",
  review: "Nothing under review. Claims that fail a fraud check, escalated holds and decisions that fail the re-check wait here.",
};

function YourMove({ item, now }: { item: Extract<ActionItem, { kind: "respond" }>; now: number }) {
  const d = item.view.decision;
  const left = item.deadline - now;
  return (
    <li>
      <Link to={claimHref("action", d.claimId)} className="queue-row row-yours">
        <span className="who who-yours">Your move</span>
        <span className="queue-main">
          <strong>
            Order #{shortId(d.orderId)} · {customerLabel(d.customerId)}
          </strong>
          <span className="muted">{caseText(d.liabilityCase)}</span>
          <span className="queue-do">Accept the split, or answer with a photo. If you do nothing, it settles as shown.</span>
        </span>
        <span className="queue-money">
          <span>{rupees(d.refundAmount)} held</span>
          <span className="muted">you'd pay {rupees(d.liability.restaurant)}</span>
        </span>
        <span className={left < SOON_MS ? "clock clock-soon" : "clock"}>
          <b>{formatRemaining(left)}</b>
          <span>to answer</span>
        </span>
        <span className="queue-go">Answer</span>
      </Link>
    </li>
  );
}

function UnderReview({ item }: { item: Extract<ActionItem, { kind: "review" }> }) {
  const v = item.view;
  const d = v.decision;
  return (
    <li>
      <Link to={claimHref("action", d.claimId)} className="queue-row row-review">
        <span className="who who-review">Reviewer</span>
        <span className="queue-main">
          <strong>
            Order #{shortId(d.orderId)} · {customerLabel(d.customerId)}
          </strong>
          <span className={v.reviewBecause.includes("audit_mismatch") ? "alert-text" : "muted"}>{reviewReason(v)}</span>
          <span className="queue-do">Nothing for you to do. A FairClaim reviewer decides and you'll see the result here.</span>
        </span>
        <span className="queue-money">
          <span>{rupees(d.assessedAmount)} claimed</span>
          <span className="muted">{d.refundAmount > 0 ? `${rupees(d.refundAmount)} already paid` : "nothing paid yet"}</span>
        </span>
        <span className="clock clock-idle">
          <b>{when(d.createdAt)}</b>
          <span>filed</span>
        </span>
        <span className="queue-go">View</span>
      </Link>
    </li>
  );
}

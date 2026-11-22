// Claims log: every claim on this restaurant's orders — who filed it, which order,
// what was claimed, how it was decided and how the evidence was checked.
import { useMemo, useState } from "react";
import type { ClaimDoc, OrderDoc } from "../data/docs.ts";
import { finalLiability, fraudSignalsOf, outcomeOf, type Outcome } from "../data/stats.ts";
import type { DecisionView } from "../data/views.ts";
import { InferenceBadge, Notice, Spinner } from "./common.tsx";
import { customerLabel, ISSUE_LABEL, OUTCOME_LABEL, rupees, shortId, when } from "./format.ts";
import { claimHref, navigate } from "./router.tsx";
import { PageHeader } from "./Shell.tsx";

type Filter = "all" | Outcome | "failed";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "refunded", label: "Refunded" },
  { id: "pending", label: "On hold" },
  { id: "review", label: "Under review" },
  { id: "failed", label: "Failed checks" },
];

interface Row {
  view: DecisionView;
  outcome: Outcome;
  failed: boolean;
  claim: ClaimDoc | null;
  claimNote: string | null;
  items: string;
  search: string;
}

export function ClaimsLog({
  views,
  orders,
  claims,
  unavailable,
  loadError,
}: {
  views: DecisionView[] | null;
  orders: ReadonlyMap<string, OrderDoc>;
  claims: ReadonlyMap<string, ClaimDoc>;
  unavailable: ReadonlyMap<string, string>;
  loadError: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo<Row[]>(
    () =>
      (views ?? []).map((v) => {
        const d = v.decision;
        const claim = claims.get(d.claimId) ?? null;
        const order = orders.get(d.orderId);
        const items = claim ? claim.selectedItemIds.map((id) => order?.items.find((i) => i.id === id)?.name ?? id).join(", ") : "";
        return {
          view: v,
          outcome: outcomeOf(v),
          failed: fraudSignalsOf(v).length > 0,
          claim,
          claimNote: unavailable.get(d.claimId) ?? null,
          items,
          search: [d.claimId, shortId(d.claimId), d.orderId, shortId(d.orderId), customerLabel(d.customerId), items].join(" ").toLowerCase(),
        };
      }),
    [views, claims, orders, unavailable],
  );

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "failed" ? r.failed : r.outcome === filter) && (q === "" || r.search.includes(q)));
  const count = (f: Filter) => rows.filter((r) => (f === "all" ? true : f === "failed" ? r.failed : r.outcome === f)).length;

  return (
    <div className="page-fill">
      <PageHeader title="Claims log" lead="Every claim on your orders, newest first. Customer IDs are pseudonyms." />
      {loadError && <Notice tone="error" title="Claims couldn't load">{loadError}</Notice>}
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter by outcome">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? "chip-btn chip-on" : "chip-btn"} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="chip-count">{count(f.id)}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="search"
          placeholder="Search order, claim or customer"
          aria-label="Search claims"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {views === null ? (
        <Spinner label="Loading claims…" />
      ) : rows.length === 0 ? (
        <p className="empty-hint">No claims yet. They appear here as soon as a customer's app files one.</p>
      ) : shown.length === 0 ? (
        <p className="empty-hint">No claims match this filter{q ? ` and “${query.trim()}”` : ""}.</p>
      ) : (
        <div className="card table-wrap">
          <table className="log">
            <thead>
              <tr>
                <th scope="col">Filed</th>
                <th scope="col">Order</th>
                <th scope="col">Problem</th>
                <th scope="col">Decision</th>
                <th scope="col" className="num">
                  Refund
                </th>
                <th scope="col" className="num">
                  You pay
                </th>
                <th scope="col">Checks</th>
                <th scope="col">Audit</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const d = r.view.decision;
                const open = () => navigate(claimHref("claims", d.claimId));
                return (
                  <tr key={d.claimId} tabIndex={0} onClick={open} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open())}>
                    <td className="nowrap">{when(d.createdAt)}</td>
                    <td className="mono-ish">
                      #{shortId(d.orderId)}
                      <span className="sub">{customerLabel(d.customerId)}</span>
                    </td>
                    <td>
                      {r.claim ? (
                        <>
                          <span className="nowrap">{ISSUE_LABEL[r.claim.issueType]}</span>
                          <span className="sub">{r.items}</span>
                        </>
                      ) : (
                        <span className="muted">{r.claimNote ?? "loading…"}</span>
                      )}
                    </td>
                    <td>
                      <span className={`pill pill-${r.outcome}`}>{OUTCOME_LABEL[r.outcome]}</span>
                      {r.failed && <span className="sub alert-text">failed checks</span>}
                    </td>
                    <td className="num">{rupees(d.refundAmount)}</td>
                    <td className="num">{rupees(finalLiability(r.view).restaurant)}</td>
                    <td className="nowrap">
                      {r.claim &&
                        [...new Set([r.claim.inferenceSources.challenge, r.claim.inferenceSources.damage].filter((x) => x !== null))].map((src) => (
                          <InferenceBadge key={src} source={src} />
                        ))}
                    </td>
                    <td className="nowrap">
                      {r.view.audit ? (
                        r.view.audit.match ? (
                          <span className="audit-ok">Matches</span>
                        ) : (
                          <span className="alert-text">Mismatch</span>
                        )
                      ) : (
                        <span className="muted">Pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

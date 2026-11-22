import type { Liability, Policy } from "@fairclaim/schemas";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import type { Services } from "../firebase/app.ts";
import { loadCase, type CaseLoad } from "../data/case.ts";
import { counterCanHelp } from "../data/counter.ts";
import { parseCounterEvidence, type CounterEvidenceDoc } from "../data/docs.ts";
import { acceptHold } from "../data/holdActions.ts";
import { formatRemaining, holdEndsAt, remainingMs } from "../data/hold.ts";
import type { DecisionView } from "../data/views.ts";
import { useDemo } from "../demo/context.ts";
import { friendlyError } from "../errors.ts";
import { Legend, SegmentedBar } from "./charts.tsx";
import { CounterEvidence } from "./CounterEvidence.tsx";
import { InferenceBadge, Notice, Spinner, StoredImage } from "./common.tsx";
import { capText, caseText, mismatchText, reasonText, rupees, shortId, VERDICT_LABEL, when } from "./format.ts";

type Loaded = { claimId: string; load: CaseLoad } | { claimId: string; error: string } | null;

export function DecisionDetail({
  services,
  uid,
  policy,
  view,
  auditNote,
  now,
}: {
  services: Services;
  uid: string;
  policy: Policy;
  view: DecisionView;
  auditNote: string | null;
  now: number;
}) {
  const { decision: d, hold, resolution, audit } = view;
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [counter, setCounter] = useState<CounterEvidenceDoc | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // On narrow screens the panel sits below the list: bring it into view.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const { claimId, orderId } = d;
  const demo = useDemo();
  useEffect(() => {
    if (demo) return; // demo cases come from memory below
    let live = true;
    loadCase(services.db, { claimId, orderId }).then(
      (load) => live && setLoaded({ claimId, load }),
      (e: unknown) => live && setLoaded({ claimId, error: friendlyError(e) }),
    );
    return () => {
      live = false;
    };
  }, [demo, services.db, claimId, orderId]);

  const answered = resolution !== null;
  useEffect(() => {
    if (!answered || demo) return;
    let live = true;
    getDoc(doc(services.db, "counterEvidence", d.claimId))
      .then((s) => live && s.exists() && setCounter(parseCounterEvidence(s.id, s.data())))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [demo, services.db, d.claimId, answered]);

  const demoCase = demo?.cases.get(claimId);
  const caseLoad: Loaded = demo
    ? { claimId, load: demoCase ? { ok: true, docs: demoCase } : { ok: false, kind: "unreadable", detail: "not in the demo data" } }
    : loaded && loaded.claimId === d.claimId
      ? loaded
      : null;
  const docs = caseLoad && "load" in caseLoad && caseLoad.load.ok ? caseLoad.load.docs : null;

  return (
    <article ref={panelRef} className="panel" aria-labelledby="decision-title">
      <header className="panel-head">
        <div>
          <h2 id="decision-title">
            <span className={`verdict verdict-${d.verdict}`}>{VERDICT_LABEL[d.verdict]}</span> {rupees(d.refundAmount)}
          </h2>
          <p className="muted">
            Claim on order #{shortId(d.orderId)}, decided {when(d.createdAt)} on the customer's phone ({d.engine === "kotlin" ? "Android engine" : "web engine"},
            policy {d.policyVersion})
          </p>
        </div>
      </header>

      {view.reviewBecause.length > 0 && (
        <Notice tone="warn" title="Under review">
          <ul className="small">
            {view.reviewBecause.includes("review_verdict") && <li>The evidence didn't pass verification, so nothing was refunded automatically.</li>}
            {view.reviewBecause.includes("escalated") && <li>The counter-evidence wasn't clear enough to settle the hold.</li>}
            {view.reviewBecause.includes("audit_mismatch") && <li>Decision mismatch: re-running the rules on the stored evidence gave a different result.</li>}
          </ul>
        </Notice>
      )}

      <section className="block">
        <h3>Who pays</h3>
        <p>{caseText(d.liabilityCase)}</p>
        {d.verdict === "review" ? (
          <p className="muted">No refund until a person reviews the claim.</p>
        ) : (
          <LiabilityBar liability={resolution?.outcome === "settled" ? resolution.liability : d.liability} total={d.refundAmount} />
        )}
        {resolution?.outcome === "settled" && <p className="muted small">Split after your counter-evidence. The customer's refund stays {rupees(resolution.refundAmount)}.</p>}
        {d.assessedAmount !== d.refundAmount && <p className="muted small">Assessed damage: {rupees(d.assessedAmount)}.</p>}
      </section>

      {hold && <HoldBox services={services} view={view} now={now} />}

      {hold?.state === "held" && docs && holdEndsAt(hold.createdAt ?? 0, hold.holdHours) > now &&
        (counterCanHelp(docs, d, policy) ? (
          !demo && <CounterEvidence services={services} uid={uid} policy={policy} view={view} docs={docs} />
        ) : (
          <section className="block">
            <h3>Why there's no photo option</h3>
            <p className="muted">
              Your dispatch photo already shows the parcel sealed with code {docs.order.sealCode ?? ""}. A second photo can't add to that, so it wouldn't
              change the split. Accept it now, or it settles on its own when the window ends.
            </p>
          </section>
        ))}

      {resolution && (
        <section className="block">
          <h3>Your counter-evidence</h3>
          <p>{resolution.outcome === "settled" ? "Accepted: the hold settled." : "Not clear enough: the claim went to human review."}</p>
          <ul className="reasons">
            {resolution.reasons.map((r) => (
              <li key={r}>{reasonText(r)}</li>
            ))}
          </ul>
          {counter && (
            <div className="evidence-row">
              <StoredImage storage={services.storage} path={counter.photoRef} alt="Counter-evidence photo" />
              <InferenceBadge source={counter.inferenceSource} />
            </div>
          )}
        </section>
      )}

      <section className="block">
        <h3>Why</h3>
        <ul className="reasons">
          {d.reasons.map((r, i) => (
            <li key={`${r}-${i}`}>{reasonText(r)}</li>
          ))}
        </ul>
      </section>

      {d.explanationRestaurant.trim() !== "" && (
        <section className="block">
          <h3>Explanation</h3>
          <p className="explanation">{capText(d.explanationRestaurant)}</p>
          <p className="muted small">Written by the cloud consistency review. It explains the decision; it never sets the amount.</p>
        </section>
      )}

      <section className="block">
        <h3>Evidence</h3>
        {!caseLoad && <Spinner label="Loading evidence…" />}
        {caseLoad && "error" in caseLoad && <Notice tone="error" title="Evidence couldn't load">{caseLoad.error}</Notice>}
        {caseLoad && "load" in caseLoad && !caseLoad.load.ok && (
          <Notice tone="warn">{caseLoad.load.kind === "claim_deleted" ? "The customer deleted this claim's data." : caseLoad.load.detail}</Notice>
        )}
        {docs && (
          <>
            <div className="evidence-grid">
              <div>
                <h4>Damage crop</h4>
                {docs.claim.cropRef ? (
                  <StoredImage storage={services.storage} path={docs.claim.cropRef} alt="The part of the claim photo the customer tapped" />
                ) : (
                  <p className="muted">No crop: missing-item claims don't need one.</p>
                )}
              </div>
              <ul className="evidence-list">
                <li>
                  <span>Dispatch photo</span>
                  {docs.dispatch ? (
                    <span>
                      Sealed, code {docs.dispatch.check.seal_code_read}
                      {docs.dispatch.check.spill_or_damage_visible ? ", damage visible" : ""} <InferenceBadge source={docs.dispatch.inferenceSource} />
                    </span>
                  ) : (
                    <span className="muted">None</span>
                  )}
                </li>
                <li>
                  <span>Handoff snap</span>
                  {docs.handoff ? (
                    <span>
                      Seal {docs.handoff.check.seal_state.replace("_", " ")} <InferenceBadge source={docs.handoff.inferenceSource} />
                    </span>
                  ) : (
                    <span className="muted">Not taken</span>
                  )}
                </li>
                <li>
                  <span>Live challenge</span>
                  <span>
                    Code {docs.claim.challengeCheck.seal_code_read || "unread"}, {docs.claim.challengeCheck.fingers_visible} of {docs.claim.challenge.fingers} finger(s){" "}
                    <InferenceBadge source={docs.claim.inferenceSources.challenge} />
                  </span>
                </li>
                {docs.claim.damageCheck && (
                  <li>
                    <span>Tapped item</span>
                    <span>
                      {docs.claim.damageCheck.matched_item || "unnamed"}: {docs.claim.damageCheck.issue.replace("_", " ")}, {docs.claim.damageCheck.severity}{" "}
                      {docs.claim.inferenceSources.damage && <InferenceBadge source={docs.claim.inferenceSources.damage} />}
                    </span>
                  </li>
                )}
                <li>
                  <span>Screen-photo check</span>
                  <span>
                    Moiré {docs.claim.moireScore.toFixed(2)} (limit {policy.moireThreshold.toFixed(2)})
                    {docs.claim.challengeCheck.photo_of_screen_suspected ? ", screen suspected" : ""}
                  </span>
                </li>
                <li>
                  <span>Claimed items</span>
                  <span>{docs.claim.selectedItemIds.map((id) => docs.order.items.find((i) => i.id === id)?.name ?? id).join(", ")}</span>
                </li>
              </ul>
            </div>
          </>
        )}
        <AuditLine audit={audit} note={auditNote} />
      </section>
    </article>
  );
}

function LiabilityBar({ liability, total }: { liability: Liability; total: number }) {
  const parts = [
    { label: "Your restaurant", value: liability.restaurant, color: "var(--viz-restaurant)" },
    { label: "Delivery partner", value: liability.transit, color: "var(--viz-delivery)" },
    { label: "Platform", value: liability.platform, color: "var(--viz-platform)", ink: "dark" as const },
  ].filter((p) => p.value > 0);
  if (total === 0 || parts.length === 0) return <p className="muted">Nothing to pay.</p>;
  return (
    <div className="liability">
      <SegmentedBar parts={parts} label="Who pays" />
      <Legend items={parts.map((p) => ({ label: p.label, color: p.color, value: rupees(p.value) }))} />
    </div>
  );
}

function HoldBox({ services, view, now }: { services: Services; view: DecisionView; now: number }) {
  const hold = view.hold;
  const demo = useDemo() !== null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!hold) return null;
  const left = hold.createdAt === null ? null : remainingMs(hold.createdAt, hold.holdHours, now);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await acceptHold(services.db, hold?.claimId ?? "");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const STATE_TEXT = {
    accepted: "You accepted this split.",
    resolved: "Settled by your counter-evidence.",
    escalated: "Escalated to human review after your counter-evidence.",
    settled: "Settled automatically: nobody answered within the window.",
  } as const;

  return (
    <section className="block hold">
      <h3>Hold</h3>
      {hold.state === "held" ? (
        <>
          <p>
            <span className="countdown">{left === null ? "Starting…" : formatRemaining(left)}</span> left to answer. After that the split above is
            settled automatically.
          </p>
          {error && <Notice tone="error">{error}</Notice>}
          {demo && <p className="muted small">Demo data: Accept and counter-evidence are turned off because nothing here is saved.</p>}
          {!demo && left !== null && left > 0 && (
            <div className="actions">
              <button type="button" className="btn" disabled={busy} onClick={() => void accept()}>
                {busy ? "Accepting…" : "Accept this split"}
              </button>
            </div>
          )}
        </>
      ) : (
        <p>{STATE_TEXT[hold.state]}</p>
      )}
    </section>
  );
}

function AuditLine({ audit, note }: { audit: DecisionView["audit"]; note: string | null }) {
  if (audit) {
    return audit.match ? (
      <p className="audit audit-ok">Replay audit: the rules give the same result on the stored evidence{audit.cropHashMatch ? ", and the crop matches its hash" : ""}.</p>
    ) : (
      <Notice tone="error" title="Decision mismatch">
        Re-running the rules on the stored evidence changes {mismatchText(audit.mismatchFields)}. The decision written by the customer's app doesn't match its own evidence.
      </Notice>
    );
  }
  return <p className="audit muted">{note ? `Replay audit pending: ${note}` : "Replay audit running…"}</p>;
}

// Signed-in restaurant: realtime data, background replay audit + hold settlement,
// and the four pages (Overview, Needs action, Orders, Claims log).
import type { Policy } from "@fairclaim/schemas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Services } from "../firebase/app.ts";
import type { LoadedPolicy } from "../firebase/policy.ts";
import { auditDecision } from "../data/auditRunner.ts";
import type { OrderDoc, RestaurantDoc } from "../data/docs.ts";
import { settleExpiredHolds } from "../data/holdActions.ts";
import { shouldSettle } from "../data/hold.ts";
import { sortOrders, watchOrders, type OrdersSnapshot } from "../data/orders.ts";
import { analytics, type PeriodDays } from "../data/analytics.ts";
import { urgentItems } from "../data/urgent.ts";
import { actionQueue } from "../data/stats.ts";
import { buildViews } from "../data/views.ts";
import { COLLECTIONS, watchByRestaurant, type AuditDoc, type DecisionDoc, type HoldDoc, type ResolutionDoc, type Watched } from "../data/watch.ts";
import { DEMO_ENABLED, DemoContext } from "../demo/context.ts";
import { buildDemoData } from "../demo/demoData.ts";
import { friendlyError } from "../errors.ts";
import { ActionQueue } from "./ActionQueue.tsx";
import { ClaimsLog } from "./ClaimsLog.tsx";
import { Notice } from "./common.tsx";
import { DecisionDetail } from "./DecisionDetail.tsx";
import { Drawer } from "./Drawer.tsx";
import { useNow, useWatch } from "./hooks.ts";
import { OrdersView } from "./Orders.tsx";
import { Overview } from "./Overview.tsx";
import { navigate, PAGE_PATH, useLocation } from "./router.tsx";
import { PageHeader, Shell } from "./Shell.tsx";
import { useClaims } from "./useClaims.ts";

function useRestaurantCollection<T>(services: Services, uid: string, c: { name: string; parse: (id: string, d: unknown) => T }) {
  const { db } = services;
  const { name, parse } = c;
  const subscribe = useCallback(
    (next: (w: Watched<T>) => void, fail: (e: unknown) => void) => watchByRestaurant(db, name, uid, parse, next, fail),
    [db, name, uid, parse],
  );
  return useWatch(subscribe);
}

export function Main({ services, uid, restaurant, policy }: { services: Services; uid: string; restaurant: RestaurantDoc; policy: LoadedPolicy }) {
  const { db, storage } = services;
  const { page, claim: openClaim, order: openOrder } = useLocation();

  const ordersSub = useCallback(
    (next: (s: OrdersSnapshot) => void, fail: (e: unknown) => void) => watchOrders(db, uid, next, fail),
    [db, uid],
  );
  const orders = useWatch(ordersSub);
  const decisions = useRestaurantCollection<DecisionDoc>(services, uid, COLLECTIONS.decisions);
  const holds = useRestaurantCollection<HoldDoc>(services, uid, COLLECTIONS.holds);
  const resolutions = useRestaurantCollection<ResolutionDoc>(services, uid, COLLECTIONS.resolutions);
  const audits = useRestaurantCollection<AuditDoc>(services, uid, COLLECTIONS.audits);
  const now = useNow(1000);
  // Dev-only sample claims (VITE_DEMO_DATA=true). Built once per page load, never written anywhere.
  const demo = useMemo(() => (DEMO_ENABLED ? buildDemoData(uid) : null), [uid]);

  // Replay audit: every decision without an audit, once per page load (§22.2).
  const [auditNotes, setAuditNotes] = useState<ReadonlyMap<string, string>>(new Map());
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    if (demo || decisions.kind !== "ready" || audits.kind !== "ready") return;
    const todo = [...decisions.value.byId.values()].filter((d) => !audits.value.byId.has(d.claimId) && !attempted.current.has(d.claimId));
    if (todo.length === 0) return;
    for (const d of todo) attempted.current.add(d.claimId);
    const note = (id: string, text: string) => setAuditNotes((m) => new Map(m).set(id, text));
    void (async () => {
      for (const d of todo) {
        try {
          const r = await auditDecision(db, storage, uid, d, policy.policy, Date.now());
          if (r.status === "skipped") note(d.claimId, r.reason);
        } catch (e) {
          note(d.claimId, friendlyError(e));
        }
      }
    })();
  }, [demo, decisions, audits, db, storage, uid, policy.policy]);

  // Settle expired, unanswered holds: on load and whenever a countdown runs out.
  const settling = useRef(false);
  const minute = Math.floor(now / 60_000);
  useEffect(() => {
    if (demo || holds.kind !== "ready" || settling.current) return;
    const t = Date.now();
    const due = [...holds.value.byId.values()].filter((h) => shouldSettle(h, t));
    if (due.length === 0) return;
    settling.current = true;
    void settleExpiredHolds(db, due, t).finally(() => {
      settling.current = false;
    });
  }, [demo, holds, minute, db]);

  const views = useMemo(() => {
    if (demo) return buildViews(demo.decisions, demo.holds, demo.resolutions, demo.audits);
    if (decisions.kind !== "ready") return null;
    const empty = new Map();
    return buildViews(
      decisions.value.byId,
      holds.kind === "ready" ? holds.value.byId : empty,
      resolutions.kind === "ready" ? resolutions.value.byId : empty,
      audits.kind === "ready" ? audits.value.byId : empty,
    );
  }, [demo, decisions, holds, resolutions, audits]);

  // Real orders always show (so dispatch can still be tested); demo orders are added alongside.
  const shownOrders = useMemo(() => {
    if (!demo || orders.kind !== "ready") return orders;
    return { kind: "ready" as const, value: { orders: sortOrders([...orders.value.orders, ...demo.orders]), unreadable: orders.value.unreadable } };
  }, [demo, orders]);
  const orderMap = useMemo(() => {
    const m = new Map<string, OrderDoc>();
    if (shownOrders.kind === "ready") for (const o of shownOrders.value.orders) m.set(o.id, o);
    return m;
  }, [shownOrders]);
  const claimIds = useMemo(() => (demo ? [] : (views ?? []).map((v) => v.decision.claimId)), [demo, views]);
  const fetched = useClaims(db, claimIds);
  const claims = demo ? demo.claims : fetched.claims;
  const unavailable = fetched.unavailable;

  const [period, setPeriod] = useState<PeriodDays>(7);
  const minuteNow = Math.floor(now / 60_000) * 60_000;
  const orderList = shownOrders.kind === "ready" ? shownOrders.value.orders : null;
  const dashboard = useMemo(
    () => (views && orderList ? analytics(views, orderList, claims, minuteNow, period) : null),
    [views, orderList, claims, minuteNow, period],
  );
  const queue = useMemo(() => actionQueue(views ?? [], now), [views, now]);
  const urgent = useMemo(() => (views && orderList ? urgentItems(queue.respond, views, orderList, now) : null), [queue, views, orderList, now]);

  const firstError = demo ? undefined : [decisions, holds, resolutions, audits].find((l) => l.kind === "error");
  const loadError = firstError?.kind === "error" ? firstError.message : null;
  // Records that fail validation are surfaced, never silently dropped (a malformed decision is a red flag).
  const unreadable = demo ? [] : [decisions, holds, resolutions, audits].flatMap((l) => (l.kind === "ready" ? l.value.unreadable : []));

  const toPack = shownOrders.kind === "ready" ? shownOrders.value.orders.filter((o) => o.status === "placed").length : 0;
  const drawerView = openClaim ? (views?.find((v) => v.decision.claimId === openClaim) ?? null) : null;
  const closeDrawer = useCallback(() => navigate(PAGE_PATH[page]), [page]);

  return (
    <DemoContext.Provider value={demo}>
    <Shell
      restaurant={restaurant}
      page={page}
      counts={{ action: queue.respond.length, toPack, claims: views?.length ?? 0 }}
      status={<PolicyChip policy={policy.policy} source={policy.source} note={policy.note} emulated={services.emulated} demo={demo !== null} />}
    >
      {unreadable.length > 0 && page !== "orders" && (
        <Notice tone="error" title={`${unreadable.length} claim record(s) failed validation`}>
          They were written by a customer's app and don't match the expected format, so treat them as needing review.
          <ul className="small">
            {unreadable.slice(0, 5).map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </Notice>
      )}
      {page === "overview" && (
        <Overview data={dashboard} period={period} onPeriod={setPeriod} queue={queue} urgent={urgent} now={now} loadError={loadError} />
      )}
      {page === "action" && <ActionQueue queue={queue} loading={views === null && !loadError} loadError={loadError} now={now} />}
      {page === "orders" && (
        <div className="page-fill">
          <PageHeader title="Orders" lead="Write the seal code on the sticker and photograph the sealed bag before it leaves." />
          <OrdersView key={openOrder ?? "orders"} services={services} orders={shownOrders} initialOrder={openOrder} />
        </div>
      )}
      {page === "claims" && <ClaimsLog views={views} orders={orderMap} claims={claims} unavailable={unavailable} loadError={loadError} />}

      {openClaim && (
        <Drawer title="Claim details" onClose={closeDrawer}>
          {drawerView ? (
            <DecisionDetail
              key={drawerView.decision.claimId}
              services={services}
              uid={uid}
              policy={policy.policy}
              view={drawerView}
              auditNote={auditNotes.get(drawerView.decision.claimId) ?? null}
              now={now}
            />
          ) : views === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <Notice tone="warn">This claim isn't on one of your orders, or it no longer exists.</Notice>
          )}
        </Drawer>
      )}
    </Shell>
    </DemoContext.Provider>
  );
}

function PolicyChip({ policy, source, note, emulated, demo }: { policy: Policy; source: "remote" | "default"; note: string | null; emulated: boolean; demo: boolean }) {
  const title =
    source === "remote"
      ? `Refund policy ${policy.policyVersion} from Remote Config: instant refunds up to ₹${policy.autoApproveCap}, holds last ${policy.holdHours} h`
      : `Built-in policy ${policy.policyVersion}. ${note ?? ""}`;
  return (
    <>
      <span className={source === "remote" ? "chip" : "chip chip-warn"} title={title}>
        Policy {policy.policyVersion}
        {source === "default" ? " (built-in)" : ""}
      </span>
      {emulated && <span className="chip chip-warn">Emulators</span>}
      {demo && (
        <span className="chip chip-warn" title="Sample claims generated in this browser by the real decision rules. Nothing is saved; holds can't be answered. Set VITE_DEMO_DATA=false and restart for real data only.">
          Demo data
        </span>
      )}
    </>
  );
}

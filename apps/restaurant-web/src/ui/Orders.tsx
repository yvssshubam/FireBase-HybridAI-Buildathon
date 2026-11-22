import { useState } from "react";
import type { Services } from "../firebase/app.ts";
import type { OrderDoc, OrderStatus } from "../data/docs.ts";
import { DispatchPanel } from "./Dispatch.tsx";
import { navigate, PAGE_PATH } from "./router.tsx";
import { Notice, Spinner } from "./common.tsx";
import { rupees, shortId, when } from "./format.ts";
import type { Loadable } from "./hooks.ts";
import type { OrdersSnapshot } from "../data/orders.ts";

const STATUS_TEXT: Record<OrderStatus, string> = { placed: "To pack", dispatched: "On the way", delivered: "Delivered" };
const FILTERS: OrderStatus[] = ["placed", "dispatched", "delivered"];
/** The list is a work queue, not an archive (the Claims log is the archive). */
const MAX_SHOWN = 60;

export function OrdersView({ services, orders, initialOrder }: { services: Services; orders: Loadable<OrdersSnapshot>; initialOrder: string | null }) {
  // Opened from the Overview's "Pack" link (/orders?order=<id>), else nothing open.
  const [openId, setOpenId] = useState<string | null>(initialOrder);
  const list = orders.kind === "ready" ? orders.value.orders : [];
  const counts = Object.fromEntries(FILTERS.map((f) => [f, list.filter((o) => o.status === f).length])) as Record<OrderStatus, number>;
  // Stays open after dispatch so the confirmation is visible.
  const open = list.find((o) => o.id === openId) ?? null;
  const [chosen, setChosen] = useState<OrderStatus | null>(null);
  const filter: OrderStatus = chosen ?? (open && open.status !== "placed" ? open.status : counts.placed > 0 ? "placed" : "dispatched");
  const filtered = list.filter((o) => o.status === filter);
  const shown = filtered.slice(0, MAX_SHOWN);

  return (
    <div className="orders">
      <section className="card orders-list" aria-label="Orders">
        <div className="chips" role="group" aria-label="Order status">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={filter === f ? "chip-btn chip-on" : "chip-btn"} aria-pressed={filter === f} onClick={() => setChosen(f)}>
              {STATUS_TEXT[f]} <span className="chip-count">{counts[f]}</span>
            </button>
          ))}
        </div>
        {orders.kind === "loading" && <Spinner label="Loading orders…" />}
        {orders.kind === "error" && <Notice tone="error" title="Orders couldn't load">{orders.message}</Notice>}
        {orders.kind === "ready" && orders.value.unreadable.length > 0 && (
          <Notice tone="warn" title={`${orders.value.unreadable.length} order(s) couldn't be read`}>
            {orders.value.unreadable.join("; ")}
          </Notice>
        )}
        {orders.kind === "ready" && list.length === 0 ? (
          <p className="empty-hint">
            No orders yet. Orders come from the FairClaim Android app: use “Connect a phone” in the sidebar, scan the QR code with the app, and place an order.
          </p>
        ) : (
          orders.kind === "ready" &&
          (filtered.length === 0 ? (
            <p className="empty-hint">{filter === "placed" ? "Nothing to pack right now." : `No orders ${STATUS_TEXT[filter].toLowerCase()}.`}</p>
          ) : (
            <ul className="tickets">
              {shown.map((o) => (
                <li key={o.id}>
                  <OrderTicket order={o} active={o.id === open?.id} onDispatch={() => setOpenId(o.id)} />
                </li>
              ))}
              {filtered.length > shown.length && <li className="muted small list-more">Showing the latest {shown.length} of {filtered.length}.</li>}
            </ul>
          ))
        )}
      </section>
      <div className="orders-work">
        {open ? (
          <DispatchPanel
            key={open.id}
            services={services}
            order={open}
            onClose={() => {
              setOpenId(null);
              if (initialOrder) navigate(PAGE_PATH.orders, true);
            }}
          />
        ) : (
          <section className="card work-empty">
            <div className="seal-sticker seal-sticker-ghost" aria-hidden="true">
              <span className="seal-label">Seal code</span>
              <span className="seal-code">0000</span>
            </div>
            <h2>Pack, seal, photograph</h2>
            <p>
              Choose an order to pack. FairClaim gives it a 4-digit seal code to write on the sticker, then Gemini checks one photo of the sealed bag. If the
              seal is still intact at the customer's door, nobody opened the bag on the way.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function OrderTicket({ order, active, onDispatch }: { order: OrderDoc; active: boolean; onDispatch: () => void }) {
  return (
    <article className={`ticket ticket-${order.status}${active ? " ticket-active" : ""}`}>
      <header className="ticket-head">
        <span className="ticket-id">#{shortId(order.id)}</span>
        <span className="muted small">{when(order.createdAt)}</span>
      </header>
      <p className="ticket-items">{order.items.map((i) => i.name).join(", ")}</p>
      <footer className="ticket-foot">
        <span className="ticket-total">{rupees(order.total)}</span>
        {order.status === "placed" ? (
          <button type="button" className="btn btn-primary btn-small" onClick={onDispatch}>
            Pack and dispatch
          </button>
        ) : (
          order.sealCode && <span className="muted small">Seal {order.sealCode}</span>
        )}
      </footer>
    </article>
  );
}

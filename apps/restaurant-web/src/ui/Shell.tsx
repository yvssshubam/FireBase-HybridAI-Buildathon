import { useCallback, useState, type ReactNode } from "react";
import { ConnectPhoneDialog } from "./ConnectPhone.tsx";
import type { RestaurantDoc } from "../data/docs.ts";
import { DeviceChip } from "./DeviceChip.tsx";
import { Link, PAGE_PATH, type Page } from "./router.tsx";

export interface NavCounts {
  /** Holds the restaurant can answer (reviews aren't theirs to act on). */
  action: number;
  toPack: number;
  claims: number;
}

const NAV: { page: Page; label: string; count?: keyof NavCounts; alert?: boolean }[] = [
  { page: "overview", label: "Overview" },
  { page: "action", label: "Needs action", count: "action", alert: true },
  { page: "orders", label: "Orders", count: "toPack" },
  { page: "claims", label: "Claims log", count: "claims" },
];

export function Shell({
  restaurant,
  page,
  counts,
  status,
  children,
}: {
  restaurant: RestaurantDoc;
  page: Page;
  counts: NavCounts;
  status: ReactNode;
  children: ReactNode;
}) {
  const [connecting, setConnecting] = useState(false);
  const close = useCallback(() => setConnecting(false), []);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">FairClaim</span>
          <span className="brand-sub">{restaurant.name}</span>
        </div>
        <nav aria-label="Pages" className="nav">
          {NAV.map((n) => {
            const c = n.count ? counts[n.count] : 0;
            return (
              <Link key={n.page} to={PAGE_PATH[n.page]} className={page === n.page ? "nav-item nav-on" : "nav-item"} ariaCurrent={page === n.page}>
                <span>{n.label}</span>
                {n.count && c > 0 && <span className={n.alert ? "count count-alert" : "count"}>{c}</span>}
              </Link>
            );
          })}
        </nav>
        <button type="button" className="btn connect-btn" onClick={() => setConnecting(true)}>
          Connect a phone
        </button>
        <div className="sidebar-status">
          {status}
          <DeviceChip />
        </div>
        <footer className="sidebar-foot">
          <span>Prototype: money is simulated.</span>
          <span>
            <a href="/terms">Terms</a> <a href="/privacy">Privacy</a>
          </span>
        </footer>
      </aside>
      <main className="page">{children}</main>
      {connecting && <ConnectPhoneDialog pairCode={restaurant.pairCode} onClose={close} />}
    </div>
  );
}

export function PageHeader({ title, lead, aside }: { title: string; lead: string; aside?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <p className="lead">{lead}</p>
      </div>
      {aside}
    </header>
  );
}

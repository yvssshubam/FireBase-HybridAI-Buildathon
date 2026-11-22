// Minimal pathname router: four pages + an optional ?claim=<id> detail drawer,
// and /orders?order=<id> to open an order's dispatch panel.
// Vercel rewrites every unknown path to index.html; /terms and /privacy are real files.
import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";

export type Page = "overview" | "action" | "orders" | "claims";

export const PAGE_PATH: Record<Page, string> = {
  overview: "/",
  action: "/action",
  orders: "/orders",
  claims: "/claims",
};

const NAV_EVENT = "fairclaim:navigate";

function subscribe(cb: () => void): () => void {
  window.addEventListener("popstate", cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}
const snapshot = () => window.location.pathname + window.location.search;

export interface Location {
  page: Page;
  claim: string | null;
  order: string | null;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseLocation(pathAndSearch: string): Location {
  const url = new URL(pathAndSearch, "https://x");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const page = (Object.entries(PAGE_PATH).find(([, p]) => p === path)?.[0] as Page | undefined) ?? "overview";
  const claim = url.searchParams.get("claim");
  const order = url.searchParams.get("order");
  return { page, claim: claim && ID.test(claim) ? claim : null, order: page === "orders" && order && ID.test(order) ? order : null };
}

export function useLocation(): Location {
  return parseLocation(useSyncExternalStore(subscribe, snapshot));
}

export function navigate(to: string, replace = false): void {
  if (to === snapshot()) return;
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAV_EVENT));
}

export const claimHref = (page: Page, claimId: string) => `${PAGE_PATH[page]}?claim=${encodeURIComponent(claimId)}`;
export const orderHref = (orderId: string) => `${PAGE_PATH.orders}?order=${encodeURIComponent(orderId)}`;

export function Link({ to, className, children, ariaCurrent }: { to: string; className?: string; children: ReactNode; ariaCurrent?: boolean }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let the browser handle new-tab / new-window clicks.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} className={className} onClick={onClick} aria-current={ariaCurrent ? "page" : undefined}>
      {children}
    </a>
  );
}

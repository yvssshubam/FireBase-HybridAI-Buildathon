import { useEffect, useRef, type ReactNode } from "react";

/** Right-hand detail panel over the current page. Esc or the backdrop closes it. */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <button type="button" className="btn btn-quiet drawer-close" onClick={onClose}>
          Close
        </button>
        {children}
      </div>
    </div>
  );
}

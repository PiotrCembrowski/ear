"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { NavLinks } from "./nav-links";

/**
 * Collapsible navigation for small screens. Escape closes it, focus moves
 * into the panel when it opens and back to the toggle when it closes.
 */
export function MobileNav({ footer, isAdmin = false }: { footer: ReactNode; isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="lg:hidden">
      <Button
        ref={toggleRef}
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </Button>
      {open && (
        <div
          id="mobile-nav-panel"
          ref={panelRef}
          className="absolute inset-x-0 top-full z-40 border-b border-line bg-surface px-4 py-4 shadow-card"
        >
          <nav aria-label="Main">
            <NavLinks onNavigate={() => setOpen(false)} isAdmin={isAdmin} />
          </nav>
          <div className="mt-4 border-t border-line pt-4">{footer}</div>
        </div>
      )}
    </div>
  );
}

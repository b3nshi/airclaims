"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ClaimTab = {
  id: string;
  label: string;
  count?: number;
  attention?: boolean; // something in the tab waits for the passenger
  content: React.ReactNode;
};

/**
 * The claim page's sections, grouped in tabs so the page stays short on a phone.
 * Every panel stays mounted (forms keep their state) and in-page links such as
 * "#messages" open the tab that contains their target.
 */
export function ClaimTabs({ tabs, label }: { tabs: ClaimTab[]; label: string }) {
  const [active, setActive] = useState<string | undefined>(tabs[0]?.id);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Opens the tab holding the element with this id (or the tab itself), then scrolls to it.
    const reveal = (id: string) => {
      const target = id ? document.getElementById(id) : null;
      const panel = target?.closest<HTMLElement>("[data-claim-tab]");
      if (!target || !panel || !root.current?.contains(panel)) return false;
      setActive(panel.dataset.claimTab);
      requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
      return true;
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href^='#']");
      if (!a) return;
      const id = a.getAttribute("href")!.slice(1);
      if (reveal(id)) {
        e.preventDefault();
        history.replaceState(null, "", `#${id}`);
      }
    };
    const onHash = () => reveal(decodeURIComponent(location.hash.slice(1)));
    const frame = requestAnimationFrame(onHash);
    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  const focusTab = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    setActive(tab.id);
    document.getElementById(`tab-${tab.id}`)?.focus();
  };

  return (
    <div ref={root} className="space-y-6">
      <div
        role="tablist"
        aria-label={label}
        className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        {tabs.map((tab, i) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") focusTab(i + 1);
                else if (e.key === "ArrowLeft") focusTab(i - 1);
                else if (e.key === "Home") focusTab(0);
                else if (e.key === "End") focusTab(tabs.length - 1);
              }}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
                selected ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-xs tabular-nums",
                    tab.attention ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {tab.count}
                </span>
              )}
              {tab.attention && tab.count === undefined && <span className="size-2 rounded-full bg-primary" aria-hidden />}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          data-claim-tab={tab.id}
          hidden={tab.id !== active}
          className="space-y-8"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}

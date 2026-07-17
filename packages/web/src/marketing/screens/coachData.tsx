import type { ReactNode } from "react";

/** Shared coach tab bar (violet). `active` = which tab is highlighted. */
export function CoachTabs({ active }: { active: "home" | "clients" | "programs" | "you" }) {
  const cls = (k: string) => `app-tab${active === k ? " active violet" : ""}`;
  return (
    <nav className="app-tabs" aria-hidden="true">
      <span className={cls("home")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
        Home
      </span>
      <span className={cls("clients")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        </svg>
        Clients
      </span>
      <span className={cls("programs")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
        Programs
      </span>
      <span className={cls("you")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
        You
      </span>
    </nav>
  );
}

export function Avatar({ initials, tone }: { initials: string; tone: string }) {
  return (
    <span className="co-av" style={{ background: tone }}>
      {initials}
    </span>
  );
}

export function StatusBar(): ReactNode {
  return (
    <div className="app-status">
      <span className="t">9:41</span>
      <span className="d" />
    </div>
  );
}

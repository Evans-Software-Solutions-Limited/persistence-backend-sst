import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  IconBell,
  IconBook,
  IconChat,
  IconToday,
  IconUser,
  IconUsers,
} from "../ui/icons";
import { Avatar } from "../ui/parts";

/**
 * The K-layout rail (canvas C11a/C3.9/C8). Clients and Library (forms,
 * PER-129) are on the web so far;
 * the other places keep their slot so the rail matches the canvas, and say so
 * rather than link to an empty page.
 */
export interface CoachShellProps {
  /** Which place is open (PER-129 adds Library). */
  active?: "clients" | "library";
  coachName: string;
  coachInitials: string;
  activeCount: number | null;
  onSignOut: () => void;
  children: ReactNode;
}

const LATER = "Not on the web yet";

function Later({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="coach-nav-item" aria-disabled="true" title={LATER}>
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      <span className="sr-only">({LATER})</span>
    </span>
  );
}

export function CoachShell({
  active = "clients",
  coachName,
  coachInitials,
  activeCount,
  onSignOut,
  children,
}: CoachShellProps) {
  return (
    <div className="persistence-coach">
      <aside className="coach-rail" aria-label="Coach">
        <div className="coach-brand">
          <b>Persistence</b>
          <span
            className="pl plV"
            style={{ height: 20, fontSize: 10, letterSpacing: 1.2 }}
          >
            COACH
          </span>
        </div>
        <nav aria-label="Main" style={{ display: "contents" }}>
          <Later icon={<IconToday />} label="Today" />
          <Later icon={<IconBell />} label="Notifications" />
          <Link
            to="/coach/clients"
            className="coach-nav-item"
            aria-current={active === "clients" ? "page" : undefined}
          >
            <IconUsers />
            <span style={{ flex: 1 }}>Clients</span>
            {activeCount !== null && (
              <span className="count mono">{activeCount}</span>
            )}
          </Link>
          <Link
            to="/coach/library/forms"
            className="coach-nav-item"
            aria-current={active === "library" ? "page" : undefined}
          >
            <IconBook />
            <span style={{ flex: 1 }}>Library</span>
          </Link>
          <Later icon={<IconChat />} label="Messages" />
          <Later icon={<IconUser />} label="You" />
        </nav>
        <div className="spacer" style={{ flex: 1 }} />
        <div className="coach-me">
          <Avatar initials={coachInitials} size={32} />
          <span className="name">{coachName}</span>
        </div>
        <button
          type="button"
          className="lk quiet"
          style={{ padding: "0 10px", minHeight: 32, fontSize: 12 }}
          onClick={onSignOut}
        >
          Sign out
        </button>
      </aside>
      <main className="coach-main">{children}</main>
    </div>
  );
}

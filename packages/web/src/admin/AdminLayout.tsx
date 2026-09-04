import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { loadSession, signOut } from "./adminAuth";

const NAV = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/grants", label: "Founding grants" },
  { to: "/admin/codes", label: "Referral codes" },
  { to: "/admin/lookup", label: "Lookup" },
  { to: "/admin/audit", label: "Audit log" },
];

/** Dense utility shell for the internal panel — not the marketing layout. */
export function AdminLayout() {
  const navigate = useNavigate();
  const session = loadSession();

  useEffect(() => {
    document.title = "Admin · Persistence";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="text-sm font-semibold tracking-tight">
            Persistence admin
          </span>
          <nav className="flex flex-wrap gap-1" aria-label="Admin">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm ${
                    isActive
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            {session?.email ? <span>{session.email}</span> : null}
            <Button
              variant="outline"
              size="xs"
              onClick={async () => {
                await signOut();
                navigate("/admin/login", { replace: true });
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

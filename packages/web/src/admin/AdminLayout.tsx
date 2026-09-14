import { useEffect } from "react";
import {
  IconLayoutDashboard,
  IconKey,
  IconTicket,
  IconSpeakerphone,
  IconSearch,
  IconHistory,
  IconLogout,
} from "@tabler/icons-react";
import { AdminBrand } from "./AdminBrand";
import { AdminDialogProvider } from "./AdminDialogs";
import "./admin.css";
import { NavLink, Outlet, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { loadSession, signOut } from "./adminAuth";

const NAV = [
  { to: "/admin", label: "Dashboard", end: true, icon: IconLayoutDashboard },
  { to: "/admin/grants", label: "Access grants", icon: IconKey },
  { to: "/admin/vouchers", label: "Business vouchers", icon: IconTicket },
  { to: "/admin/codes", label: "Referral codes", icon: IconTicket },
  { to: "/admin/marketing", label: "Marketing", icon: IconSpeakerphone },
  { to: "/admin/lookup", label: "Lookup", icon: IconSearch },
  { to: "/admin/audit", label: "Audit log", icon: IconHistory },
];

/** Branded, responsive shell for the internal admin workspace. */
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
    <AdminDialogProvider>
      <div className="persistence-admin admin-shell">
        <a className="admin-skip" href="#admin-content">
          Skip to content
        </a>
        <aside className="admin-sidebar">
          <AdminBrand />
          <p className="admin-nav-label">Manage your community</p>
          <nav className="admin-nav" aria-label="Admin">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `admin-nav-link${isActive ? " is-active" : ""}`
                }
              >
                <item.icon size={19} stroke={1.6} aria-hidden="true" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="admin-account">
            <span className="admin-nav-label">Signed in</span>
            {session?.email ? (
              <span className="admin-account-email">{session.email}</span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await signOut();
                navigate("/admin/login", { replace: true });
              }}
            >
              <IconLogout size={16} aria-hidden="true" /> Sign out
            </Button>
          </div>
        </aside>
        <main id="admin-content" className="admin-content" tabIndex={-1}>
          <div className="admin-workspace-label">
            Persistence <span>/</span> Administration
          </div>
          <Outlet />
        </main>
      </div>
    </AdminDialogProvider>
  );
}

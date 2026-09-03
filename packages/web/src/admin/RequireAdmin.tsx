import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { getAccessToken, loadSession } from "./adminAuth";

/**
 * UX-only guard for `/admin/*` (FRONTEND_BRIEF § W1): no session → login; a
 * signed-in account without the admin claim → a plain "not an admin" page.
 * The API enforces the real rule on every call.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<"checking" | "none" | "not-admin" | "ok">(
    "checking",
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (cancelled) return;
      if (!token) return setState("none");
      const session = loadSession();
      setState(session?.isAdmin ? "ok" : "not-admin");
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (state === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Checking your session…
      </div>
    );
  }
  if (state === "none") {
    return (
      <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
    );
  }
  if (state === "not-admin") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">This account isn't an admin</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          You're signed in, but this account has no admin access. Sign out and
          use the admin account, or ask for the claim to be added.
        </p>
        <a
          href="/admin/login"
          className="text-sm font-medium text-primary underline"
        >
          Back to sign in
        </a>
      </main>
    );
  }
  return <>{children}</>;
}

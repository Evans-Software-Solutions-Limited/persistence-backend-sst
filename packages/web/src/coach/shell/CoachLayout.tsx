import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import "../coach.css";
import { getAccessToken, onSignedOut, signOut } from "../api/coachAuth";
import { isCoachApiError } from "../api/coachApi";
import { COACH_ROLES } from "../api/types";
import { coachKeys, useCoachProfile, useRoster } from "../hooks/coachQueries";
import { initials } from "../lib/people";
import { LoadError, Loading } from "../ui/parts";
import { CoachShell } from "./CoachShell";

/**
 * Container for every signed-in coach page: session → profile → role, then
 * the rail with the page in it. The API enforces the real rule on each call;
 * this only decides what to show.
 */
export function CoachLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<"checking" | "none" | "ok">(
    "checking",
  );

  useEffect(() => {
    let cancelled = false;
    getAccessToken().then((token) => {
      if (!cancelled) setSession(token ? "ok" : "none");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A 401 or a rejected refresh anywhere ends the session: drop the coach's
  // cached data and go to sign-in, instead of leaving error screens whose
  // Retry can never succeed.
  useEffect(
    () =>
      onSignedOut(() => {
        queryClient.removeQueries({ queryKey: coachKeys.all });
        navigate("/coach/login", {
          replace: true,
          state: { from: location.pathname },
        });
      }),
    [queryClient, navigate, location.pathname],
  );

  if (session === "checking") {
    return (
      <div className="persistence-coach">
        <div className="center-page">
          <Loading label="Checking your session…" />
        </div>
      </div>
    );
  }
  if (session === "none") {
    return (
      <Navigate to="/coach/login" replace state={{ from: location.pathname }} />
    );
  }
  return (
    <SignedIn
      onSignOut={async () => {
        await signOut();
        queryClient.removeQueries({ queryKey: coachKeys.all });
        navigate("/coach/login", { replace: true });
      }}
    />
  );
}

function SignedIn({ onSignOut }: { onSignOut: () => void }) {
  const location = useLocation();
  const profile = useCoachProfile();
  const isCoach = !!profile.data && COACH_ROLES.has(profile.data.role);
  const roster = useRoster();

  if (profile.isPending) {
    return (
      <div className="persistence-coach">
        <div className="center-page">
          <Loading />
        </div>
      </div>
    );
  }
  if (profile.error) {
    if (isCoachApiError(profile.error) && profile.error.status === 401) {
      return (
        <Navigate
          to="/coach/login"
          replace
          state={{ from: location.pathname }}
        />
      );
    }
    return (
      <div className="persistence-coach">
        <div
          className="center-page"
          style={{ flexDirection: "column", gap: 12 }}
        >
          <LoadError
            message={
              isCoachApiError(profile.error) && profile.error.offline
                ? "You're offline. Connect to open your coach workspace."
                : "We couldn't load your account."
            }
            onRetry={() => profile.refetch()}
          />
        </div>
      </div>
    );
  }
  if (!isCoach) {
    return (
      <div className="persistence-coach">
        <div
          className="center-page"
          style={{ flexDirection: "column", gap: 12, textAlign: "center" }}
        >
          <h1 className="h1" style={{ fontSize: 26, lineHeight: "32px" }}>
            This account isn't a coach account
          </h1>
          <p className="sub" style={{ maxWidth: 420 }}>
            The coach workspace is for personal trainers and physiotherapists.
            Sign in with the account you coach from.
          </p>
          <button type="button" className="btn sm ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const name = profile.data!.fullName ?? "Coach";
  return (
    <CoachShell
      active={
        location.pathname.startsWith("/coach/library") ? "library" : "clients"
      }
      coachName={name}
      coachInitials={initials(name)}
      activeCount={
        roster.data
          ? roster.data.data.filter((c) => c.status === "active").length
          : null
      }
      onSignOut={onSignOut}
    >
      <Outlet />
    </CoachShell>
  );
}

import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import "../coach.css";
import { getAccessToken, onSignedOut, signOut } from "../api/coachAuth";
import {
  isCoachApiError,
  isCoachSubscriptionRequired,
  onCoachSubscriptionRequired,
} from "../api/coachApi";
import { COACH_ROLES } from "../api/types";
import { COACH_PLANS_REDIRECT } from "@/lib/coachPlans";
import { coachKeys, useCoachProfile, useRoster } from "../hooks/coachQueries";
import { initials } from "../lib/people";
import { LoadError, Loading } from "../ui/parts";
import { CoachShell } from "./CoachShell";
import { placeFor } from "./places";
import { useFeed, useToday } from "../notifications/queries";

/**
 * Container for every signed-in coach page: session → profile → role →
 * coach subscription, then the rail with the page in it. The API enforces the
 * real rule on each call; this only decides what to show.
 *
 * PER-146: without a coach role, or when the API refuses the roster with
 * `coach_subscription_required`, the coach goes to the coach plans page
 * (`/pricing`, Coaches tab). A subscription that lapses mid-session sends
 * them there on the next refused call.
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
    void getAccessToken().then((token) => {
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
        void navigate("/coach/login", {
          replace: true,
          state: { from: location.pathname },
        });
      }),
    [queryClient, navigate, location.pathname],
  );

  // Any coach call refused for want of a coach subscription (e.g. it lapsed
  // mid-session) leaves for the coach plans page and drops cached coach data.
  useEffect(
    () =>
      onCoachSubscriptionRequired(() => {
        queryClient.removeQueries({ queryKey: coachKeys.all });
        void navigate(COACH_PLANS_REDIRECT, { replace: true });
      }),
    [queryClient, navigate],
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
        void navigate("/coach/login", { replace: true });
      }}
    />
  );
}

function SignedIn({ onSignOut }: { onSignOut: () => void }) {
  const location = useLocation();
  const profile = useCoachProfile();
  const isCoach = !!profile.data && COACH_ROLES.has(profile.data.role);
  const roster = useRoster();
  // PER-131: the rail's Today and Notifications counts.
  // Only once the roster shows the coach may use the workspace.
  const today = useToday(!!roster.data);
  const feed = useFeed(!!roster.data);

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
  if (
    !isCoach ||
    isCoachSubscriptionRequired(roster.error ?? roster.failureReason)
  ) {
    return <Navigate to={COACH_PLANS_REDIRECT} replace />;
  }
  // The roster is the first call the API checks the coach subscription on:
  // wait for its FIRST attempt so a coach without one never sees the
  // workspace flash up. Any other failure shows the shell straight away
  // (the roster keeps retrying in the background), as before.
  if (roster.isPending && roster.failureCount === 0) {
    return (
      <div className="persistence-coach">
        <div className="center-page">
          <Loading />
        </div>
      </div>
    );
  }

  const name = profile.data!.fullName ?? "Coach";
  return (
    <CoachShell
      active={placeFor(location.pathname)}
      todayCount={today.data ? today.data.counts.total : null}
      unreadCount={feed.data ? feed.data.unreadCount : null}
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

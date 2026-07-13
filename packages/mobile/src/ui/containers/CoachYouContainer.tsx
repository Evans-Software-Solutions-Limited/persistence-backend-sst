import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetCoachOverview } from "@/ui/hooks/useGetCoachOverview";
import { useGetStreaks } from "@/ui/hooks/useGetStreaks";
import { useModeSwitch } from "@/ui/hooks/useModeSwitch";
import { useDrawer } from "@/state/drawer";
import { useAddClientSheet } from "@/state/add-client-sheet";
import { initialsOf } from "@/shared/utils";
import type { Streak } from "@/domain/models/streak";
import type { WorkoutSession } from "@/domain/models/session";
import { CoachYouPresenter } from "@/ui/presenters/CoachYouPresenter";

/**
 * <CoachYouContainer> — coach-mode "You" tab (10-trainer-features). Wires the
 * cache-first coach overview into <CoachYouPresenter>, plus:
 *   - the coach's OWN training peek (athlete-side `useGetStreaks` workout_streak
 *     + the latest cached session), reused with no new backend;
 *   - mode switch → athlete via `useModeSwitch().switchMode("athlete", "you")`;
 *   - drawer open (avatar + "Coach settings") via `useDrawer`;
 *   - invite via the root-mounted AddClient sheet (`useAddClientSheet`), which
 *     refreshes the overview through the registered `onInvited` callback.
 */

/** Pick the workout streak to feature, else the first. */
function pickWorkoutStreak(streaks: Streak[]): Streak | null {
  return (
    streaks.find((s) => s.streakType === "workout_streak") ?? streaks[0] ?? null
  );
}

/** Build the prototype's "Last session: <name> · <m>m" caption. */
export function buildSessionCaption(
  session: WorkoutSession | null,
): string | null {
  if (!session) return null;
  const name = session.name?.trim() || "Session";
  // Derive the duration from started/completed timestamps (WorkoutSession
  // doesn't carry a precomputed seconds field).
  if (session.completedAt) {
    const start = new Date(session.startedAt).getTime();
    const end = new Date(session.completedAt).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
      const mins = Math.round((end - start) / 60_000);
      return `Last session: ${name} · ${mins}m`;
    }
  }
  return `Last session: ${name}`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function CoachYouContainer() {
  const router = useRouter();
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const overview = useGetCoachOverview();
  const streaks = useGetStreaks();
  const { switchMode } = useModeSwitch();
  const openDrawer = useDrawer((s) => s.openDrawer);
  const openSheet = useAddClientSheet((s) => s.openSheet);

  const trainer = overview.data?.trainer ?? null;

  const initials = useMemo(() => {
    if (trainer?.initials) return trainer.initials;
    return initialsOf(session?.email ?? "") || "?";
  }, [trainer?.initials, session?.email]);

  const coachName = trainer?.name?.trim() || "Coach";

  const coachMeta = useMemo(() => {
    const parts: string[] = [];
    const since = trainer?.coachSince ?? null;
    if (since) {
      const d = new Date(since);
      if (!Number.isNaN(d.getTime())) {
        // coachSince is a UTC ISO string (server: profiles.created_at). Read it
        // with UTC accessors so the month/year match what the server wrote —
        // local accessors shift it for negative-UTC viewers near a boundary
        // (e.g. 2024-01-01T00:00Z → "Dec 2023" in UTC-8).
        parts.push(
          `Coach since ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`,
        );
      }
    }
    const active = overview.data?.businessStats.activeClients ?? 0;
    parts.push(`${active} active client${active === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }, [trainer?.coachSince, overview.data?.businessStats.activeClients]);

  // UTC month to match the backend's "this month" buckets (newClientsThisMonth,
  // clientPRsThisMonth use startOfMonth() in UTC). A local month here would
  // disagree with those numbers for negative-UTC viewers near a boundary.
  const monthLabel = MONTHS[new Date().getUTCMonth()];

  // Own-training peek — reuse the athlete-side streak + latest cached session.
  const primaryStreak = useMemo(
    () => pickWorkoutStreak(streaks.data ?? []),
    [streaks.data],
  );
  const streakCount = primaryStreak?.currentCount ?? 0;
  const streakUnit = primaryStreak?.period === "weekly" ? "week" : "day";

  const sessionCaption = useMemo(() => {
    if (!userId) return null;
    return buildSessionCaption(storage.getLatestSession(userId));
  }, [storage, userId]);

  const refreshOverview = overview.refresh;
  const refreshStreaks = streaks.refresh;
  const onRefresh = useCallback(() => {
    void Promise.all([refreshOverview(), refreshStreaks()]);
  }, [refreshOverview, refreshStreaks]);

  const onSwitchToAthlete = useCallback(() => {
    void switchMode("athlete", "you");
  }, [switchMode]);

  const onInvite = useCallback(() => {
    // Register the overview refresh so a successful invite re-pulls slot counts.
    openSheet(() => {
      void refreshOverview();
    });
  }, [openSheet, refreshOverview]);

  const noop = useCallback(() => {}, []);
  const onOpenWorkoutLibrary = useCallback(() => {
    router.push("/(app)/workouts/library");
  }, [router]);

  return (
    <CoachYouPresenter
      overview={overview.data}
      initials={initials}
      coachName={coachName}
      coachMeta={coachMeta}
      monthLabel={monthLabel}
      streakCount={streakCount}
      streakUnit={streakUnit}
      sessionCaption={sessionCaption}
      isLoading={
        (overview.isRefreshing ||
          (overview.isStale && overview.error === null)) &&
        overview.data === null
      }
      isRefreshing={overview.isRefreshing}
      error={overview.error}
      onRefresh={onRefresh}
      onOpenDrawer={openDrawer}
      onSwitchToAthlete={onSwitchToAthlete}
      onOpenCoachSettings={openDrawer}
      onInvite={onInvite}
      onStartSession={noop}
      onViewAllPrograms={noop}
      onOpenWorkoutLibrary={onOpenWorkoutLibrary}
    />
  );
}

import { useCallback, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { ScrollView } from "react-native";
import { useScrollToTopOnTabPress } from "@/ui/hooks/useScrollToTopOnTabPress";
import { useAuth } from "@/ui/hooks/useAuth";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useGetStreaks } from "@/ui/hooks/useGetStreaks";
import { useGetAchievements } from "@/ui/hooks/useGetAchievements";
import { useGetVolumeStats } from "@/ui/hooks/useGetVolumeStats";
import { useGetBodyMeasurements } from "@/ui/hooks/useGetBodyMeasurements";
import { useGetPRHistory } from "@/ui/hooks/useGetPRHistory";
import { useUseFreezeToken } from "@/ui/hooks/useUseFreezeToken";
import { useHealthData } from "@/ui/hooks/useHealthData";
import { useHealthWeightSync } from "@/ui/hooks/useHealthWeightSync";
import { useClientRelationships } from "@/ui/hooks/useClientRelationships";
import { useDrawer } from "@/state/drawer";
import { useFocusEffect, useRouter } from "expo-router";
import { initialsOf } from "@/shared/utils";
import { toneHex, type Tone } from "@/ui/components/foundation/tones";
import {
  IconFlame,
  IconBolt,
  IconDumbbell,
  IconMedal,
  IconCrown,
} from "@/ui/components/icons";
import type { Achievement } from "@/domain/models/achievement";
import type { Streak } from "@/domain/models/streak";
import { YouPresenter } from "@/ui/presenters/YouPresenter";
import type { MilestoneTier } from "@/ui/presenters/MilestonesRowPresenter";

const WORKOUT_TIERS: {
  threshold: number;
  label: string;
  tone: Tone;
  Icon: typeof IconFlame;
}[] = [
  { threshold: 1, label: "1w", tone: "ember", Icon: IconFlame },
  { threshold: 2, label: "2w", tone: "primary", Icon: IconBolt },
  { threshold: 4, label: "4w", tone: "gold", Icon: IconDumbbell },
  { threshold: 8, label: "2mo", tone: "trainer", Icon: IconMedal },
  { threshold: 12, label: "3mo", tone: "gold", Icon: IconCrown },
];

/** Map unlocked workout-streak achievements to the 5 milestone tier cells. */
export function buildMilestoneTiers(
  achievements: Achievement[],
): MilestoneTier[] {
  const earned = new Set(
    achievements
      .filter(
        (a) =>
          a.category === "streak" &&
          a.requirements?.streak_type === "workout_streak",
      )
      .map((a) => Number(a.requirements?.threshold)),
  );
  return WORKOUT_TIERS.map((t): MilestoneTier => {
    const isEarned = earned.has(t.threshold);
    return {
      label: t.label,
      earned: isEarned,
      tone: t.tone,
      // Icon `color` is an exempt concrete-colour position; "#8A8A98" = $text3.
      icon: (
        <t.Icon size={20} color={isEarned ? toneHex(t.tone).base : "#8A8A98"} />
      ) as ReactNode,
    };
  });
}

/** Pick the streak to feature: the active workout_streak, else the first. */
function pickPrimaryStreak(streaks: Streak[]): Streak | null {
  return (
    streaks.find((s) => s.streakType === "workout_streak") ?? streaks[0] ?? null
  );
}

/**
 * <YouContainer> — athlete Progress/You screen (06-progress-goals, STORY-003).
 * Wires the cache-first streak/achievement/volume/body/PR hooks into
 * <YouPresenter>. (Coach You variant is owned by 10-trainer-features.)
 */
export function YouContainer() {
  const { session } = useAuth();
  const profile = useProfilePage();
  const openDrawer = useDrawer((s) => s.openDrawer);
  const router = useRouter();

  const scrollRef = useRef<ScrollView>(null);
  useScrollToTopOnTabPress(scrollRef);

  // Pull any coach-logged weights into HealthKit on open (weight-sync flow).
  useHealthWeightSync();

  // Avatar initials prefer the profile name (legacy parity, mirrors
  // HomeContainer); cache-first via useProfilePage, with the email as a
  // fallback until the profile resolves.
  const fullName = profile.payload?.profile.fullName ?? null;

  const streaks = useGetStreaks();
  const achievements = useGetAchievements();
  const volume = useGetVolumeStats("month");
  const body = useGetBodyMeasurements(30);
  const prs = useGetPRHistory();
  const freeze = useUseFreezeToken();

  // HealthKit / Health Connect latest body weight. The /body-trend API only
  // carries weigh-ins logged IN the app, so a user who records weight solely
  // in Apple Health saw an empty weight tile. We fall back to (or, when more
  // recent, prefer) the platform health reading. HealthWeight.unit is
  // "kg" | "lbs"; the trend series is kg, so convert lbs → kg.
  const health = useHealthData();
  const healthWeight = useMemo(() => {
    const w = health.latestBodyWeight;
    if (!w) return null;
    const kg = w.unit === "lbs" ? w.value * 0.45359237 : w.value;
    return { kg, date: w.date };
  }, [health.latestBodyWeight]);
  // HealthKit body-fat reading ({ value, date }), same rationale as weight:
  // the /body-trend API only carries body fat logged IN the app, so a
  // connected scale (Renpho → Apple Health) left the body-fat tile empty.
  const healthBodyFat = health.latestBodyFat;

  // Client-side trainer relationships → the "Your trainer" You-page block +
  // the pending-request prompt (10-trainer-features). Both pending and active
  // come back in one fetch.
  const relationships = useClientRelationships();
  const trainer = useMemo(() => {
    const active = relationships.data.find((r) => r.status === "active");
    return active
      ? {
          name: active.trainerName,
          role: active.trainerRole,
          since: active.since,
        }
      : null;
  }, [relationships.data]);
  // Coach Mode Phase 8 (invite/QR): a `pending` row is either TRAINER-
  // initiated (an email invite / unredeemed code — the ATHLETE accepts via
  // the Requests screen) or CLIENT-initiated (the athlete redeemed a coach's
  // code — the COACH accepts; the athlete just waits). Only the former
  // counts toward the reviewable prompt; the latter surfaces separately as
  // an "awaiting acceptance" line.
  const pendingRequestCount = useMemo(
    () =>
      relationships.data.filter(
        // `!== "client"` (not `=== "trainer"`) so a payload missing initiatedBy
        // still counts as a reviewable request — matches RequestsContainer's
        // deploy-ordering-safe default (Inspector Brad).
        (r) => r.status === "pending" && r.initiatedBy !== "client",
      ).length,
    [relationships.data],
  );
  const myPendingCoachRequests = useMemo(
    () =>
      relationships.data
        .filter((r) => r.status === "pending" && r.initiatedBy === "client")
        .map((r) => ({
          relationshipId: r.relationshipId,
          trainerName: r.trainerName,
        })),
    [relationships.data],
  );
  const onOpenRequests = useCallback(() => {
    router.push("/(app)/requests" as never);
  }, [router]);
  const onOpenAcceptInvite = useCallback(() => {
    router.push("/(app)/accept-invite" as never);
  }, [router]);

  const primary = useMemo(
    () => pickPrimaryStreak(streaks.data ?? []),
    [streaks.data],
  );

  const streak = useMemo(() => {
    if (!primary) return null;
    return {
      current: primary.currentCount,
      longest: primary.longestCount,
      freezeTokens: primary.freezeTokens,
      unit: primary.period === "weekly" ? "weeks" : "days",
    };
  }, [primary]);

  const milestones = useMemo(
    () => buildMilestoneTiers(achievements.data ?? []),
    [achievements.data],
  );
  const earnedCount = useMemo(
    () => milestones.filter((m) => m.earned).length,
    [milestones],
  );

  const bodyTrend = useMemo(() => {
    const pts = body.data ?? [];
    const weightSeries = pts
      .map((p) => p.weightKg)
      .filter((w): w is number => w != null);
    const fatSeries = pts
      .map((p) => p.bodyFat)
      .filter((f): f is number => f != null);
    const delta = (s: number[]) => (s.length > 1 ? s[s.length - 1] - s[0] : 0);

    // Merge the platform health weight when the API has none, or when the
    // health reading is newer than the latest in-app weigh-in. Appending to
    // the series keeps the sparkline + delta consistent with the displayed
    // current value.
    const lastApiWeightDate = [...pts]
      .reverse()
      .find((p) => p.weightKg != null)?.date;
    const healthWeightIsNewer =
      healthWeight != null &&
      (weightSeries.length === 0 ||
        lastApiWeightDate == null ||
        new Date(healthWeight.date).getTime() >
          new Date(lastApiWeightDate).getTime());

    let weightSeriesMerged = weightSeries;
    if (healthWeight != null && healthWeightIsNewer) {
      weightSeriesMerged = [...weightSeries, healthWeight.kg];
    }

    // Body fat: same merge rule as weight, on the fat sample's OWN date —
    // never the weight's recency as a proxy (a scale can sync a fresh weight
    // without a new fat measurement, which would surface a stale fat value as
    // "current" and skew the delta).
    const lastApiFatDate = [...pts]
      .reverse()
      .find((p) => p.bodyFat != null)?.date;
    const healthFatIsNewer =
      healthBodyFat != null &&
      (fatSeries.length === 0 ||
        lastApiFatDate == null ||
        new Date(healthBodyFat.date).getTime() >
          new Date(lastApiFatDate).getTime());

    let fatSeriesMerged = fatSeries;
    if (healthBodyFat != null && healthFatIsNewer) {
      fatSeriesMerged = [...fatSeries, healthBodyFat.value];
    }

    return {
      weight: {
        current: weightSeriesMerged[weightSeriesMerged.length - 1] ?? null,
        delta: delta(weightSeriesMerged),
        series: weightSeriesMerged,
        unit: "kg" as const,
      },
      bodyFat: {
        current: fatSeriesMerged[fatSeriesMerged.length - 1] ?? null,
        delta: delta(fatSeriesMerged),
        series: fatSeriesMerged,
      },
    };
  }, [body.data, healthWeight, healthBodyFat]);

  const workoutsLabel = volume.data
    ? `THIS MONTH · ${volume.data.workouts} WORKOUTS`
    : "LIFETIME";

  // Pull out the stable callbacks so the handlers memoise on THOSE, not the
  // hook-result objects (fresh literals each render, which would defeat the
  // useCallbacks — bugbot regression on PR #37). exhaustive-deps can't see that
  // `streaks.refresh` etc. are stable, so destructuring keeps it correct AND
  // lint-clean.
  const refreshStreaks = streaks.refresh;
  const refreshAchievements = achievements.refresh;
  const refreshVolume = volume.refresh;
  const refreshBody = body.refresh;
  const reloadBody = body.reload;
  const refreshPRs = prs.refresh;
  const refreshHealth = health.refresh;
  const refreshRelationships = relationships.refresh;
  const spendFreezeToken = freeze.mutate;
  const onRefresh = useCallback(() => {
    void Promise.all([
      refreshStreaks(),
      refreshAchievements(),
      refreshVolume(),
      refreshBody(),
      refreshPRs(),
      refreshHealth(),
      refreshRelationships(),
    ]);
  }, [
    refreshStreaks,
    refreshAchievements,
    refreshVolume,
    refreshBody,
    refreshPRs,
    refreshHealth,
    refreshRelationships,
  ]);

  // The weigh-in sheet is logged from the HOME tab, but this (retained) You
  // tab owns the body-trend chart. Tab screens aren't unmounted on blur, so
  // returning here after a weigh-in would otherwise show a stale chart until a
  // pull-to-refresh. A focus-time reload() re-reads the (already-written) cache
  // synchronously — instant + offline-safe — so the new measurement shows the
  // moment You regains focus. Mirrors ProfileContainer's focus refresh, but a
  // sync cache read rather than a network GET (the optimistic write is local).
  // Also re-pull trainer relationships on focus: the "Have a coach's code?"
  // entry lives on this tab, so returning from the redeem screen lands back
  // here — without a refresh the "awaiting acceptance" card (Phase 8) would be
  // computed from pre-redeem data and stay empty until a manual pull-to-refresh
  // (Inspector Brad). Network GET, unlike the body cache re-read above.
  useFocusEffect(
    useCallback(() => {
      reloadBody();
      void refreshRelationships();
    }, [reloadBody, refreshRelationships]),
  );

  const onUseToken = useCallback(async () => {
    if (!primary) return;
    await spendFreezeToken(primary.id);
    void refreshStreaks();
  }, [spendFreezeToken, primary, refreshStreaks]);

  const noop = useCallback(() => {}, []);

  return (
    <YouPresenter
      scrollRef={scrollRef}
      initials={initialsOf(fullName ?? session?.email ?? "") || "?"}
      workoutsLabel={workoutsLabel}
      streak={streak}
      milestones={milestones}
      earnedCount={earnedCount}
      bodyTrend={bodyTrend}
      volumeStats={volume.data}
      prHistory={prs.data ?? []}
      trainer={trainer}
      pendingRequestCount={pendingRequestCount}
      myPendingCoachRequests={myPendingCoachRequests}
      isLoading={
        (streaks.isRefreshing || (streaks.isStale && streaks.error === null)) &&
        streaks.data === null
      }
      isRefreshing={streaks.isRefreshing}
      error={streaks.error}
      busyToken={freeze.isPending}
      onRefresh={onRefresh}
      onOpenDrawer={openDrawer}
      onOpenCalendar={noop}
      onUseToken={onUseToken}
      onOpenRequests={onOpenRequests}
      onOpenAcceptInvite={onOpenAcceptInvite}
    />
  );
}

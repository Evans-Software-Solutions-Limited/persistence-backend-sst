import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetStreaks } from "@/ui/hooks/useGetStreaks";
import { useGetAchievements } from "@/ui/hooks/useGetAchievements";
import { useGetVolumeStats } from "@/ui/hooks/useGetVolumeStats";
import { useGetBodyMeasurements } from "@/ui/hooks/useGetBodyMeasurements";
import { useGetPRHistory } from "@/ui/hooks/useGetPRHistory";
import { useUseFreezeToken } from "@/ui/hooks/useUseFreezeToken";
import { useDrawer } from "@/state/drawer";
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
  const openDrawer = useDrawer((s) => s.openDrawer);

  const streaks = useGetStreaks();
  const achievements = useGetAchievements();
  const volume = useGetVolumeStats("month");
  const body = useGetBodyMeasurements(30);
  const prs = useGetPRHistory();
  const freeze = useUseFreezeToken();

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
    return {
      weight: {
        current: weightSeries[weightSeries.length - 1] ?? null,
        delta: delta(weightSeries),
        series: weightSeries,
        unit: "kg" as const,
      },
      bodyFat: {
        current: fatSeries[fatSeries.length - 1] ?? null,
        delta: delta(fatSeries),
        series: fatSeries,
      },
    };
  }, [body.data]);

  const workoutsLabel = volume.data
    ? `THIS MONTH · ${volume.data.workouts} WORKOUTS`
    : "LIFETIME";

  const onRefresh = useCallback(() => {
    void Promise.all([
      streaks.refresh(),
      achievements.refresh(),
      volume.refresh(),
      body.refresh(),
      prs.refresh(),
    ]);
  }, [streaks, achievements, volume, body, prs]);

  const onUseToken = useCallback(async () => {
    if (!primary) return;
    await freeze.mutate(primary.id);
    void streaks.refresh();
  }, [freeze, primary, streaks]);

  const noop = useCallback(() => {}, []);

  return (
    <YouPresenter
      initials={initialsOf(session?.email ?? "") || "?"}
      workoutsLabel={workoutsLabel}
      streak={streak}
      milestones={milestones}
      earnedCount={earnedCount}
      bodyTrend={bodyTrend}
      volumeStats={volume.data}
      prHistory={prs.data ?? []}
      isLoading={streaks.isStale && streaks.data === null}
      isRefreshing={streaks.isRefreshing}
      error={streaks.error}
      busyToken={freeze.isPending}
      onRefresh={onRefresh}
      onOpenDrawer={openDrawer}
      onOpenCalendar={noop}
      onUseToken={onUseToken}
    />
  );
}

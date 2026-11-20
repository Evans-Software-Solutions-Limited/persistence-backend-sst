import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useScrollToTopOnTabPress } from "@/ui/hooks/useScrollToTopOnTabPress";
import { useAuth } from "@/ui/hooks/useAuth";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useGetAchievements } from "@/ui/hooks/useGetAchievements";
import { useGetBodyMeasurements } from "@/ui/hooks/useGetBodyMeasurements";
import { useHealthData } from "@/ui/hooks/useHealthData";
import { useHealthWeightSync } from "@/ui/hooks/useHealthWeightSync";
import { useClientRelationships } from "@/ui/hooks/useClientRelationships";
import { useTrainingLog } from "@/ui/hooks/useTrainingLog";
import { useDrawer } from "@/state/drawer";
import { initialsOf, KG_PER_LB, weightInUnit } from "@/shared/utils";
import type { WeightUnit } from "@/shared/utils";
import {
  bodyMapShading,
  lastSevenDays,
  musclesForSessions,
  sessionsBetween,
  startOfDayOffset,
  toLocalDate,
  topLifts,
  trainingTotals,
} from "@/domain/services/youPage";
import { trainNextAndRest } from "@/domain/services/trainingMetrics/muscleCredit";
import {
  YouPresenter,
  type YouBadge,
  type YouCoach,
  type YouTile,
} from "@/ui/presenters/YouPresenter";
import {
  deltaText,
  liftRows,
  restLine,
  totalsStrip,
  trainNextLine,
  whenLabel,
} from "@/ui/presenters/you/youFormat";
import {
  needsRemote,
  youRemoteUnavailable,
  type YouRemoteSource,
} from "@/application/queries/youRemote";
import { buildMilestoneTiers } from "./buildMilestoneTiers";

// Re-exported so existing callers/tests keep working (the mapping lives in
// its own module, shared with <AchievementsContainer>).
export { buildMilestoneTiers };

const BADGE_ICONS: YouBadge["icon"][] = [
  "flame",
  "bolt",
  "dumbbell",
  "medal",
  "crown",
];

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function roleLabel(role: string | null): string {
  switch (role) {
    case "physiotherapist":
      return "Physiotherapist";
    case "personal_trainer":
      return "Personal Trainer";
    case "admin":
      return "Coach";
    default:
      return "Trainer";
  }
}

/** "Personal Trainer · since Mar 2026", or the role alone without a date. */
export function coachSubtitle(role: string | null, since: string | null) {
  const d = since ? new Date(since) : null;
  if (!d || Number.isNaN(d.getTime())) return roleLabel(role);
  return `${roleLabel(role)} · since ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type DatedReading = { date: string; value: number };

/**
 * A body tile from dated readings, oldest first: the latest value, when it
 * was taken, and the change across `windowDays` ("+0.4 this week").
 */
export function bodyTile(
  readings: readonly DatedReading[],
  p: {
    unit: string;
    now: Date;
    windowDays: number;
    period: string;
    convert?: (v: number) => number;
  },
): YouTile {
  const convert = p.convert ?? ((v: number) => v);
  const at = (r: DatedReading) => toLocalDate(r.date).getTime();
  const sorted = [...readings].sort((a, b) => at(a) - at(b));
  const last = sorted[sorted.length - 1];
  if (!last) return { value: null, unit: p.unit, detail: null, series: [] };
  const since = p.now.getTime() - p.windowDays * 86_400_000;
  const inWindow = sorted.filter((r) => at(r) >= since);
  const when = whenLabel(last.date, p.now);
  const delta =
    inWindow.length > 1
      ? convert(last.value) - convert(inWindow[0]!.value)
      : null;
  return {
    value: convert(last.value).toFixed(1),
    unit: p.unit,
    detail: delta == null ? when : `${when} · ${deltaText(delta, p.period)}`,
    series: sorted.map((r) => convert(r.value)),
  };
}

/** Add a Health reading when it's newer than the app's latest. */
function withHealth(
  readings: DatedReading[],
  health: DatedReading | null,
): DatedReading[] {
  if (!health) return readings;
  const latest = Math.max(
    ...readings.map((r) => toLocalDate(r.date).getTime()),
    -Infinity,
  );
  return toLocalDate(health.date).getTime() > latest
    ? [...readings, health]
    : readings;
}

/**
 * <YouContainer> — athlete You page (PER-141, canvas Y1). Offline-first:
 * muscles, last 7 days and top lifts come from the phone's training log;
 * tiles from the cached body trend and Health; coaches from the cached
 * relationships. Coach You is `CoachYouContainer`.
 */
export function YouContainer({
  remote = youRemoteUnavailable,
}: { remote?: YouRemoteSource } = {}) {
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const profile = useProfilePage();
  const weightUnit: WeightUnit = profile.payload?.profile.weightUnit ?? "kg";
  const gender =
    profile.payload?.profile.gender === "female" ? "female" : "male";
  const openDrawer = useDrawer((s) => s.openDrawer);
  const router = useRouter();

  const scrollRef = useRef<ScrollView>(null);
  useScrollToTopOnTabPress(scrollRef);
  // Pull any coach-logged weights into HealthKit on open (weight-sync flow).
  useHealthWeightSync();

  const fullName = profile.payload?.profile.fullName ?? null;
  const achievements = useGetAchievements();
  const body = useGetBodyMeasurements(30);
  const health = useHealthData();
  const relationships = useClientRelationships();
  // The 7-day window moves with the date; the log reads only that window.
  const dayKeyNow = new Date().toDateString();
  const window7 = useMemo(
    () => ({
      from: lastSevenDays(new Date()).from,
      // To the end of today, so a workout finished later today still counts.
      to: new Date(startOfDayOffset(new Date(), 1).getTime() - 1),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayKeyNow],
  );
  const log = useTrainingLog(userId, window7);
  // The week before the phone's log began isn't on the phone: ask the BE-H1
  // seam (unavailable until PER-113). Y1 has no coverage note on the canvas,
  // so until then the page shows what the phone holds.
  // When PER-113 lands, its answer replaces the week model below.
  // Only once signed in: before auth resolves there's no log to judge.
  const weekPartial = userId != null && needsRemote(log.since, window7.from);
  useEffect(() => {
    if (weekPartial) void remote.lastSevenDays();
  }, [remote, weekPartial]);
  // Each workout's own records (the PR cache keeps only the latest best).
  const records = log.records;

  const week = useMemo(() => {
    const w = window7;
    const sessions = sessionsBetween(log.sessions, w.from, w.to);
    const rows = musclesForSessions(sessions, log.musclesOf);
    const split = trainNextAndRest(rows);
    const trainNext = trainNextLine(split.trainNext);
    const rest = restLine(split.rest);
    return {
      totals: trainingTotals(sessions),
      lifts: topLifts(sessions, records, w.from),
      muscles: {
        shading: bodyMapShading(
          rows,
          `Last 7 days.${trainNext ? ` Train next: ${trainNext.text.toLowerCase()}.` : ""}${rest ? ` Rest: ${rest.text.toLowerCase()} have had their week` : ""}`,
        ),
        gender,
        trainNext,
        rest,
      } as const,
    };
  }, [log.sessions, log.musclesOf, records, gender, window7]);

  const coaches = useMemo<YouCoach[]>(
    () =>
      relationships.data
        .filter((r) => r.status === "active")
        .map((r) => ({
          id: r.relationshipId,
          initials: initialsOf(r.trainerName) || "?",
          name: r.trainerName,
          subtitle: coachSubtitle(r.trainerRole, r.since),
        })),
    [relationships.data],
  );
  // Kept until APP-A3 (PER-126) re-homes coach requests: TRAINER-initiated
  // pendings are reviewable here; CLIENT-initiated ones await the coach.
  const pendingRequestCount = relationships.data.filter(
    (r) => r.status === "pending" && r.initiatedBy !== "client",
  ).length;
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

  const badges = useMemo<YouBadge[]>(
    () =>
      buildMilestoneTiers(achievements.data ?? []).map((t, i) => ({
        label: t.label,
        earned: t.earned,
        icon: BADGE_ICONS[i] ?? "flame",
      })),
    [achievements.data],
  );

  const tiles = useMemo(() => {
    const at = new Date();
    const pts = body.data ?? [];
    const healthWeight = health.latestBodyWeight
      ? {
          date: health.latestBodyWeight.date,
          value:
            health.latestBodyWeight.unit === "lbs"
              ? health.latestBodyWeight.value * KG_PER_LB
              : health.latestBodyWeight.value,
        }
      : null;
    const weights = withHealth(
      pts.flatMap((p) =>
        p.weightKg != null ? [{ date: p.date, value: p.weightKg }] : [],
      ),
      healthWeight,
    );
    const fats = withHealth(
      pts.flatMap((p) =>
        p.bodyFat != null ? [{ date: p.date, value: p.bodyFat }] : [],
      ),
      health.latestBodyFat,
    );
    const days = health.stepsHistory.slice(-7).map((d) => d.steps);
    const known = days.filter((d) => d > 0);
    const avg = known.length
      ? Math.round(known.reduce((a, b) => a + b, 0) / known.length)
      : null;
    return {
      weight: bodyTile(weights, {
        unit: weightUnit,
        now: at,
        windowDays: 7,
        period: "this week",
        convert: (kg) => weightInUnit(kg, weightUnit),
      }),
      bodyFat: bodyTile(fats, {
        unit: "%",
        now: at,
        windowDays: 30,
        period: "this month",
      }),
      steps: {
        today:
          health.stepsToday != null
            ? health.stepsToday.toLocaleString("en-GB")
            : null,
        detail:
          avg != null
            ? `Avg ${avg.toLocaleString("en-GB")} · last 7 days`
            : null,
        days: Array.from({ length: 7 }, (_, i) => {
          const v = days[days.length - 7 + i];
          return v == null || v <= 0 ? null : v;
        }),
        accessibilityLabel: `Steps last 7 days: ${days.length ? days.map((d) => d.toLocaleString("en-GB")).join(", ") : "none"}`,
      },
    };
  }, [
    body.data,
    health.latestBodyWeight,
    health.latestBodyFat,
    health.stepsHistory,
    health.stepsToday,
    weightUnit,
  ]);

  const push = useCallback(
    (path: string) => router.push(path as never),
    [router],
  );

  const refreshAchievements = achievements.refresh;
  const refreshBody = body.refresh;
  const reloadBody = body.reload;
  const refreshHealth = health.refresh;
  const refreshRelationships = relationships.refresh;
  const reloadLog = log.reload;
  const onRefresh = useCallback(() => {
    reloadLog();
    void Promise.all([
      refreshAchievements(),
      refreshBody(),
      refreshHealth(),
      refreshRelationships(),
    ]);
  }, [
    reloadLog,
    refreshAchievements,
    refreshBody,
    refreshHealth,
    refreshRelationships,
  ]);

  // Tab screens stay mounted, so re-read on focus: the training log and body
  // trend are local (instant, offline); the rest refresh silently.
  useFocusEffect(
    useCallback(() => {
      reloadLog();
      reloadBody();
      void refreshRelationships({ silent: true });
      void refreshAchievements({ silent: true });
    }, [reloadLog, reloadBody, refreshRelationships, refreshAchievements]),
  );

  return (
    <YouPresenter
      scrollRef={scrollRef}
      initials={initialsOf(fullName ?? session?.email ?? "") || "?"}
      coaches={coaches}
      pendingRequestCount={pendingRequestCount}
      myPendingCoachRequests={myPendingCoachRequests}
      gallery={null}
      badges={badges}
      muscles={week.muscles}
      lastSevenDays={totalsStrip(week.totals, weightUnit)}
      weight={tiles.weight}
      bodyFat={tiles.bodyFat}
      steps={tiles.steps}
      topLifts={liftRows(week.lifts, weightUnit)}
      // The training log is local, so the page always has something to draw
      // once auth resolves; the loader only covers the first profile read.
      hasData={userId != null}
      isLoading={userId == null}
      isRefreshing={achievements.isRefreshing}
      error={null}
      onRefresh={onRefresh}
      onOpenDrawer={openDrawer}
      onOpenSettings={openDrawer}
      onOpenRequests={() => push("/(app)/requests")}
      onOpenAcceptInvite={() => push("/(app)/accept-invite")}
      onOpenBadges={() => push("/(app)/achievements")}
      onOpenWeight={() => push("/(app)/weight-history")}
      onOpenBodyFat={() => push("/(app)/body-fat-history")}
      onOpenHistory={() => push("/(app)/history")}
      onOpenRecap={() => push("/(app)/recap")}
    />
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import type { BodyTrendPoint } from "@/domain/models/progress";
import type { HabitCompletion } from "@/domain/models/habit-completion";
import type { HabitConfig } from "@/domain/models/habit-config";
import type { FuelToday } from "@/domain/models/nutrition";
import type { HealthDailySteps } from "@/domain/ports/health.port";
import {
  bodyMapShading,
  dayKey,
  historyDay,
  monthCells,
  toLocalDate,
  workedList,
  type HistoryDayModel,
} from "@/domain/services/youPage";
import {
  needsRemote,
  youRemoteUnavailable,
  type YouRemoteSource,
} from "@/application/queries/youRemote";
import type { WeightUnit } from "@/shared/utils";
import { weightInUnit } from "@/shared/utils";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useHealthData } from "@/ui/hooks/useHealthData";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useTrainingLog } from "@/ui/hooks/useTrainingLog";
import {
  HistoryPresenter,
  type HistoryDayView,
} from "@/ui/presenters/HistoryPresenter";
import {
  clockTime,
  dayMonth,
  minutesText,
  volumeShort,
} from "@/ui/presenters/you/youFormat";

/** Everything else the phone has cached about a day. */
export type DayExtras = {
  fuel: FuelToday | null;
  steps: number | null;
  weightKg: number | null;
  /** Habit ticks that day, by category. */
  habits: ReadonlySet<HabitConfig["category"]>;
  /** The sleep habit's hours target when it was ticked. */
  sleepHours: number | null;
};

const completionDay = (c: HabitCompletion) =>
  c.localCompletedDate ?? c.completedAt.slice(0, 10);

/** What the phone knows about one day besides workouts. */
export function dayExtras(
  key: string,
  p: {
    fuel: FuelToday | null;
    steps: readonly HealthDailySteps[];
    body: readonly BodyTrendPoint[];
    habitConfigs: readonly HabitConfig[];
    completions: readonly HabitCompletion[];
  },
): DayExtras {
  const goals = new Map(
    p.habitConfigs.flatMap((c) => (c.goalId ? [[c.goalId, c] as const] : [])),
  );
  const habits = new Set<HabitConfig["category"]>();
  let sleepHours: number | null = null;
  for (const c of p.completions) {
    if (completionDay(c) !== key) continue;
    const cfg = goals.get(c.goalId);
    if (!cfg) continue;
    habits.add(cfg.category);
    if (cfg.category === "sleep") sleepHours = c.value ?? cfg.targetValue;
  }
  const steps = p.steps.find((s) => dayKey(s.date) === key)?.steps ?? null;
  const weight = [...p.body]
    .reverse()
    .find((b) => b.weightKg != null && dayKey(b.date) === key);
  return {
    fuel: p.fuel,
    steps: steps && steps > 0 ? steps : null,
    weightKg: weight?.weightKg ?? null,
    habits,
    sleepHours,
  };
}

/** True when the day has anything logged besides workouts. */
export function extrasLogged(e: DayExtras): boolean {
  return (
    (e.fuel?.consumed.kcal ?? 0) > 0 ||
    (e.fuel?.consumed.waterCups ?? 0) > 0 ||
    e.steps != null ||
    e.weightKg != null ||
    e.habits.size > 0
  );
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** The Y2 breakdown for a selected day. */
export function historyDayView(
  model: HistoryDayModel,
  extras: DayExtras,
  p: { gender: "male" | "female"; unit: WeightUnit },
): HistoryDayView {
  const date = new Date(`${model.key}T12:00:00`);
  const trained = model.workouts.length > 0;
  const any = trained || extrasLogged(extras);
  const worked = workedList(model.muscles);
  const fuel = extras.fuel;
  const target = fuel?.targets?.dailyKcal ?? null;
  const kcal = fuel && fuel.consumed.kcal > 0 ? fuel.consumed.kcal : null;
  const cups = fuel?.consumed.waterCups ?? 0;
  return {
    key: model.key,
    title: date
      .toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "long",
      })
      .replace(",", ""),
    status: !any ? "Nothing logged" : trained ? "Training day" : "Rest day",
    trained,
    shading: bodyMapShading(
      model.muscles,
      trained ? `Muscles worked: ${worked.toLowerCase()}` : "No muscles worked",
      true,
    ),
    gender: p.gender,
    musclesText: trained && worked ? worked : "Nothing trained",
    summary: trained
      ? `${plural(model.totals.workouts, "workout", "workouts")} · ${minutesText(model.totals.durationSeconds)} · ${volumeShort(model.totals.volumeKg, p.unit)}`
      : "Rest day",
    workoutsTitle:
      model.workouts.length > 1
        ? plural(model.workouts.length, "workout", "workouts")
        : "Workout",
    workouts: model.workouts.map((w) => {
      const detail = [
        minutesText(w.totals.durationSeconds),
        volumeShort(w.totals.volumeKg, p.unit),
        plural(w.totals.sets, "set", "sets"),
        ...(w.records ? [`★ ${plural(w.records, "record", "records")}`] : []),
      ].join(" · ");
      return {
        id: w.id,
        time: clockTime(w.startedAt),
        name: w.name,
        detail,
        accessibilityLabel: `${w.name} at ${clockTime(w.startedAt)}, ${detail}. Open the summary`,
      };
    }),
    values: [
      {
        label: "Calories",
        value:
          kcal == null
            ? "—"
            : target
              ? `${Math.round(kcal).toLocaleString("en-GB")} / ${Math.round(target).toLocaleString("en-GB")}`
              : Math.round(kcal).toLocaleString("en-GB"),
      },
      {
        label: "Steps",
        value:
          extras.steps != null ? extras.steps.toLocaleString("en-GB") : "—",
      },
      {
        label: "Weight",
        value:
          extras.weightKg != null
            ? `${weightInUnit(extras.weightKg, p.unit).toFixed(1)} ${p.unit}`
            : "—",
      },
      {
        label: "Water",
        value: extras.habits.has("water")
          ? cups > 0
            ? `${plural(cups, "cup", "cups")} ✓`
            : "✓"
          : cups > 0
            ? plural(cups, "cup", "cups")
            : "—",
        good: extras.habits.has("water"),
      },
      {
        label: "Sleep",
        value: extras.sleepHours != null ? `${extras.sleepHours}h ✓` : "—",
        good: extras.sleepHours != null,
      },
    ],
  };
}

/**
 * <HistoryContainer> — Y2 History (PER-141). Offline-first from the cache:
 * workouts from the training log, food from cached Fuel days, weight from
 * the body trend, steps from Health, habits from cached completions. Months
 * before this phone's log go through the BE-H1 seam (`youRemote`), which
 * answers `unavailable` until PER-113 ships.
 */
export function HistoryContainer({
  remote = youRemoteUnavailable,
}: { remote?: YouRemoteSource } = {}) {
  const router = useRouter();
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const profile = useProfilePage();
  const unit: WeightUnit = profile.payload?.profile.weightUnit ?? "kg";
  const gender =
    profile.payload?.profile.gender === "female" ? "female" : "male";
  const health = useHealthData();

  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState({
    y: today.getFullYear(),
    m: today.getMonth(),
  });
  const [selected, setSelected] = useState(dayKey(today));
  // Read only the month on screen and the selected day (which can sit in
  // another month after paging).
  const range = useMemo(() => {
    const day = toLocalDate(selected);
    const first = new Date(month.y, month.m, 1);
    const next = new Date(month.y, month.m + 1, 1);
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    return {
      from: first < dayStart ? first : dayStart,
      to: new Date(Math.max(next.getTime(), dayEnd.getTime()) - 1),
    };
  }, [month, selected]);
  const log = useTrainingLog(userId, range);
  const [cacheTick, setCacheTick] = useState(0);
  const reloadLog = log.reload;
  useFocusEffect(
    useCallback(() => {
      reloadLog();
      setCacheTick((t) => t + 1);
    }, [reloadLog]),
  );

  const cached = useMemo(() => {
    void cacheTick;
    if (!userId) return { body: [], habitConfigs: [], completions: [] };
    return {
      body: storage.getCachedBodyTrend(userId),
      habitConfigs: storage.getHabitConfigs(userId),
      completions: storage.getCachedHabitCompletions(userId),
    };
  }, [storage, userId, cacheTick]);

  const extrasFor = useCallback(
    (key: string) =>
      dayExtras(key, {
        fuel: userId ? storage.getCachedFuelToday(userId, key) : null,
        steps: health.stepsHistory,
        ...cached,
      }),
    [storage, userId, health.stepsHistory, cached],
  );

  const monthStart = useMemo(() => new Date(month.y, month.m, 1), [month]);
  const [remoteDays, setRemoteDays] = useState<{
    month: string;
    days: readonly string[] | null;
  } | null>(null);
  const monthId = `${month.y}-${String(month.m + 1).padStart(2, "0")}`;
  const partial = needsRemote(log.since, monthStart);
  useEffect(() => {
    if (!partial) return;
    let live = true;
    void remote.historyMonth(monthId).then((r) => {
      if (live)
        setRemoteDays({
          month: monthId,
          days: r.status === "ok" ? r.data : null,
        });
    });
    return () => {
      live = false;
    };
  }, [remote, monthId, partial]);
  const remoteForMonth =
    remoteDays?.month === monthId ? remoteDays.days : undefined;

  const cells = useMemo(() => {
    const logged = new Set<string>(remoteForMonth ?? []);
    for (const s of log.sessions) logged.add(dayKey(s.startedAt));
    const draft = monthCells(month.y, month.m, new Set(), today);
    for (const c of draft)
      if (c.key && !c.future && extrasLogged(extrasFor(c.key)))
        logged.add(c.key);
    return monthCells(month.y, month.m, logged, today);
  }, [log.sessions, month, today, extrasFor, remoteForMonth]);

  const day = useMemo(
    () =>
      historyDayView(
        historyDay(selected, log.sessions, log.records, log.musclesOf),
        extrasFor(selected),
        { gender, unit },
      ),
    [selected, log, extrasFor, gender, unit],
  );

  const isCurrentMonth =
    month.y === today.getFullYear() && month.m === today.getMonth();
  const shift = (by: number) =>
    setMonth((cur) => {
      const d = new Date(cur.y, cur.m + by, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <HistoryPresenter
      monthTitle={monthStart.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric",
      })}
      cells={cells}
      selectedKey={selected}
      canGoNext={!isCurrentMonth}
      coverageNote={
        partial && remoteForMonth == null && log.since
          ? `This phone keeps your history from ${dayMonth(log.since)}.`
          : null
      }
      day={day}
      onBack={() => router.back()}
      onPrevMonth={() => shift(-1)}
      onNextMonth={() => shift(1)}
      onSelectDay={setSelected}
      onOpenWorkout={(id) =>
        router.push({
          pathname: "/(app)/history-workout",
          params: { id, at: log.sessions.find((s) => s.id === id)?.startedAt },
        } as never)
      }
    />
  );
}

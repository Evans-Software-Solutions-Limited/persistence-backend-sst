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
  idsKey,
  needsRemote,
  remoteHistoryDayModel,
  serverHolds,
  type YouRemoteSource,
} from "@/application/queries/youRemote";
import type { RemoteHistoryDay } from "@/domain/models/trainingReads";
import { useYouRemote } from "@/ui/hooks/useYouRemote";
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

/**
 * A server History day's extras (BE-H1), for a day before this phone's
 * log. The phone's own cache wins where it has the day (a cached Fuel day
 * carries that day's own target); the server fills the rest. Its calorie
 * target is today's until target history ships (PER-114), as the response
 * says (`calories.targetSource`).
 */
export function remoteDayExtras(
  d: RemoteHistoryDay,
  local: DayExtras,
): DayExtras {
  const habits = new Set(local.habits);
  for (const h of d.habits) habits.add(h as HabitConfig["category"]);
  const kcal = d.calories.kcal;
  const target = d.calories.targetKcal;
  const fuel: FuelToday | null =
    local.fuel ??
    (kcal == null && d.waterCups === 0
      ? null
      : {
          date: d.date,
          // Only the calories are shown for a past day; macros aren't sent.
          targets:
            target == null
              ? null
              : {
                  userId: "",
                  dailyKcal: target,
                  proteinG: 0,
                  carbsG: 0,
                  fatG: 0,
                  waterCups: 0,
                  preset: null,
                  setByUserId: null,
                  setByName: null,
                  updatedAt: null,
                },
          consumed: {
            kcal: kcal ?? 0,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            waterCups: d.waterCups,
          },
          remainingKcal: target == null ? 0 : target - (kcal ?? 0),
          entriesBySlot: { breakfast: [], lunch: [], snack: [], dinner: [] },
        });
  return {
    fuel,
    steps: local.steps ?? d.steps,
    weightKg: local.weightKg ?? d.weightKg,
    habits,
    sleepHours: local.sleepHours ?? d.sleepHours,
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

/** Local midnight of a `YYYY-MM-DD` day. */
const startOfLocalDay = (key: string) => {
  const d = toLocalDate(key);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

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
 * and days before this phone's log go through the BE-H1 seam (`youRemote`,
 * PER-113), whose answers are kept for offline; with neither the server
 * nor a kept answer, the page says what the phone covers.
 */
export function HistoryContainer({
  remote: remoteProp,
}: { remote?: YouRemoteSource } = {}) {
  const live = useYouRemote();
  const remote = remoteProp ?? live;
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

  // A selected day before this phone's log: ask the server for it.
  const dayPartial = needsRemote(log.since, startOfLocalDay(selected));
  const dayIds = idsKey(
    log.sessions.filter((s) => dayKey(s.startedAt) === selected),
  );
  const [remoteDay, setRemoteDay] = useState<{
    key: string;
    data: RemoteHistoryDay | null;
  } | null>(null);
  useEffect(() => {
    if (!dayPartial || !remote.historyDay) return;
    let alive = true;
    void remote.historyDay(selected).then((r) => {
      if (alive)
        setRemoteDay({
          key: selected,
          data: r.status === "ok" ? r.data : null,
        });
    });
    return () => {
      alive = false;
    };
    // Ask again when the day's workouts change (a sync renaming one).
  }, [remote, selected, dayPartial, dayIds]);
  const remoteForDay =
    dayPartial && remoteDay?.key === selected ? remoteDay.data : null;

  const day = useMemo(() => {
    const local = historyDay(
      selected,
      log.sessions,
      log.records,
      log.musclesOf,
    );
    const localExtras = extrasFor(selected);
    // The server's day, only when it has every workout the phone holds.
    const server =
      remoteForDay &&
      serverHolds(
        remoteForDay.workouts.map((w) => w.id),
        local.workouts,
      )
        ? remoteForDay
        : null;
    return historyDayView(
      server ? remoteHistoryDayModel(selected, server) : local,
      server ? remoteDayExtras(server, localExtras) : localExtras,
      { gender, unit },
    );
  }, [selected, log, extrasFor, gender, unit, remoteForDay]);

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
          params: {
            id,
            at:
              log.sessions.find((s) => s.id === id)?.startedAt ??
              remoteForDay?.workouts.find((w) => w.id === id)?.startedAt,
          },
        } as never)
      }
    />
  );
}

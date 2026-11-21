import { useEffect, useMemo, useState } from "react";
import { Share } from "react-native";
import { router } from "expo-router";
import type { Streak } from "@/domain/models/streak";
import {
  bodyMapShading,
  buildRecap,
  previousRecapWindow,
  recapWindow,
  sessionsBetween,
  type RecapModel,
  type RecapPeriod,
} from "@/domain/services/youPage";
import {
  idsKey,
  needsRemote,
  remoteRecapModel,
  serverHolds,
  type YouRemoteSource,
} from "@/application/queries/youRemote";
import type { RemoteRecap } from "@/domain/models/trainingReads";
import { useYouRemote } from "@/ui/hooks/useYouRemote";
import type { WeightUnit } from "@/shared/utils";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetStreaks } from "@/ui/hooks/useGetStreaks";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useTrainingLog } from "@/ui/hooks/useTrainingLog";
import { RecapPresenter, type RecapPage } from "@/ui/presenters/RecapPresenter";
import {
  dayMonth,
  hoursMinutes,
  liftRows,
  volumeShort,
} from "@/ui/presenters/you/youFormat";
import {
  listNames,
  recordText,
  recordValue,
} from "@/ui/presenters/summaryFormat";

/** "This week", "October", "Aug – Oct". */
export function periodLabel(period: RecapPeriod, now: Date): string {
  if (period === "week") return "This week";
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "long" });
  if (period === "month") return month(now);
  const from = recapWindow("3months", now).from;
  const short = (d: Date) => d.toLocaleDateString("en-GB", { month: "short" });
  return `${short(from)} – ${short(now)}`;
}

/** "1 more than last week", "2 fewer than September", "+11% volume vs …". */
export function comparison(model: RecapModel, now: Date): string {
  if (model.period === "3months") {
    const before = model.previous.volumeKg;
    if (before <= 0) return "";
    const pct = Math.round(((model.totals.volumeKg - before) / before) * 100);
    return `${pct >= 0 ? "+" : "−"}${Math.abs(pct)}% volume vs the 3 months before`;
  }
  const than =
    model.period === "week"
      ? "last week"
      : new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString(
          "en-GB",
          { month: "long" },
        );
  const diff = model.totals.workouts - model.previous.workouts;
  if (diff === 0) return `Same as ${than}`;
  return `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than ${than}`;
}

/** "6 wk" from the cached workout streak, or "—". */
export function streakText(streaks: readonly Streak[]): string {
  const s =
    streaks.find((x) => x.streakType === "workout_streak") ?? streaks[0];
  if (!s) return "—";
  return `${s.currentCount} ${s.period === "weekly" ? "wk" : "d"}`;
}

/** Every Y4 page with data, in canvas order. */
export function recapPages(
  model: RecapModel,
  p: {
    now: Date;
    unit: WeightUnit;
    streak: string;
    /**
     * False when the period before isn't fully on the phone: comparing
     * against a part-kept window ("2 more than last week") would mislead,
     * so the line is left out.
     */
    compare?: boolean;
  },
): RecapPage[] {
  const eb = periodLabel(model.period, p.now);
  const vol = volumeShort(model.totals.volumeKg, p.unit).split(" ");
  const pages: RecapPage[] = [
    {
      kind: "big",
      id: "totals",
      eyebrow: eb,
      big: String(model.totals.workouts),
      unit: "workouts",
      sub: p.compare === false ? "" : comparison(model, p.now),
      trio: [
        { value: volumeShort(model.totals.volumeKg, p.unit), label: "Volume" },
        { value: hoursMinutes(model.totals.durationSeconds), label: "Time" },
        { value: p.streak, label: "Streak" },
      ],
    },
  ];
  const worked = model.muscles
    .filter((m) => m.credit > 0)
    .sort((a, b) => b.credit - a.credit);
  if (worked.length)
    pages.push({
      kind: "muscles",
      id: "muscles",
      eyebrow: `${eb} · muscle balance`,
      shading: bodyMapShading(
        model.muscles,
        `Muscle balance: ${worked.map((m) => `${m.label} ${m.share} percent`).join(", ")}`,
        true,
      ),
      rows: worked.map((m) => ({ label: m.label, share: m.share })),
    });
  if (model.lifts.length)
    pages.push({
      kind: "list",
      id: "lifts",
      eyebrow: `${eb} · top lifts`,
      lifts: liftRows(model.lifts, p.unit),
    });
  if (model.volume.length)
    pages.push({
      kind: "big",
      id: "volume",
      eyebrow: `${eb} · volume`,
      big: vol[0]!,
      unit: vol[1]!,
      sub: `Most on ${model.volume[0]!.name}`,
      trio: model.volume.slice(0, 3).map((v) => ({
        value: volumeShort(v.volumeKg, p.unit),
        label: v.name,
      })),
    });
  if (model.records.length) {
    const top = model.records[0]!;
    pages.push({
      kind: "big",
      id: "records",
      eyebrow: `${eb} · records`,
      big: String(model.records.length),
      unit: model.records.length === 1 ? "PR" : "PRs",
      sub: `${top.exerciseName} ${recordText(top, top.value, p.unit)}`,
      trio: model.records.slice(0, 3).map((r) => ({
        // Each record type in its own unit: reps, a clock, metres or weight.
        value: recordValue(r.recordType, r.value, p.unit).value,
        label: r.exerciseName,
      })),
      gold: true,
    });
  }
  if (model.together.sessions)
    pages.push({
      kind: "big",
      id: "together",
      eyebrow: `${eb} · trained together`,
      big: String(model.together.sessions),
      unit: model.together.sessions === 1 ? "session" : "sessions",
      sub: model.together.names.length
        ? `With ${listNames(model.together.names)}`
        : "",
      trio: [],
    });
  return pages;
}

/** What Share sends for a recap page, as text. */
export function recapShareText(page: RecapPage): string {
  const head = `Persistence · ${page.eyebrow}`;
  if (page.kind === "big")
    return [
      head,
      `${page.big} ${page.unit}`,
      page.sub,
      ...page.trio.map((t) => `${t.label}: ${t.value}`),
    ]
      .filter(Boolean)
      .join("\n");
  if (page.kind === "muscles")
    return [head, ...page.rows.map((r) => `${r.label} ${r.share}%`)].join("\n");
  return [
    head,
    ...page.lifts.map((l) => `${l.rank}. ${l.name} ${l.value}`),
  ].join("\n");
}

/**
 * <RecapContainer> — Y4 See a recap (PER-141). Built on the phone from the
 * training log; a period that starts before this phone's log goes through
 * the BE-H1 seam (`youRemote`, PER-113). Without the server or a kept
 * answer, the page says what it covers.
 */
export function RecapContainer({
  remote: remoteProp,
}: { remote?: YouRemoteSource } = {}) {
  const live = useYouRemote();
  const remote = remoteProp ?? live;
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const profile = useProfilePage();
  const unit: WeightUnit = profile.payload?.profile.weightUnit ?? "kg";
  const gender =
    profile.payload?.profile.gender === "female" ? "female" : "male";
  const streaks = useGetStreaks();
  const [period, setPeriod] = useState<RecapPeriod>("week");
  const now = useMemo(() => new Date(), []);
  // Wide enough for every period and the one before it (3 + 3 months).
  const range = useMemo(
    () => ({ from: previousRecapWindow("3months", now).from, to: now }),
    [now],
  );
  const log = useTrainingLog(userId, range);

  // Ask the server (BE-H1) when the period or the one before it starts
  // before the phone's log.
  const partial = needsRemote(log.since, previousRecapWindow(period, now).from);
  const currentPartial = needsRemote(log.since, recapWindow(period, now).from);
  const periodSessions = useMemo(() => {
    const w = recapWindow(period, now);
    return sessionsBetween(log.sessions, w.from, w.to);
  }, [period, now, log.sessions]);
  const periodIds = idsKey(periodSessions);
  const [remoteState, setRemoteState] = useState<{
    period: RecapPeriod;
    data: RemoteRecap | null;
  } | null>(null);
  useEffect(() => {
    if (!partial) return;
    let alive = true;
    void remote.recap(period).then((r) => {
      if (alive)
        setRemoteState({ period, data: r.status === "ok" ? r.data : null });
    });
    return () => {
      alive = false;
    };
    // Ask again when the period's workouts change (a new one, or a sync
    // swapping a `local-…` id for the server's).
  }, [remote, period, partial, periodIds]);

  const remoteRecap =
    partial && remoteState?.period === period ? remoteState.data : null;
  const remoteOk = remoteRecap != null;
  // The comparison needs the whole period before on the phone, or the
  // server's answer for it.
  const previousCovered =
    !needsRemote(log.since, previousRecapWindow(period, now).from) || remoteOk;
  const pages = useMemo(() => {
    const local = buildRecap({
      period,
      now,
      sessions: log.sessions,
      records: log.records,
      musclesOf: log.musclesOf,
    });
    // The server's recap, only when it counts every workout the phone
    // holds for the period (one still queued would otherwise vanish).
    const model =
      remoteRecap &&
      userId &&
      serverHolds(remoteRecap.sessionIds, periodSessions)
        ? remoteRecapModel(remoteRecap, userId)
        : local;
    return recapPages(model, {
      now,
      unit,
      streak: streakText(streaks.data ?? []),
      compare: previousCovered,
    });
  }, [
    period,
    now,
    log,
    unit,
    streaks.data,
    previousCovered,
    remoteRecap,
    userId,
    periodSessions,
  ]);

  return (
    <RecapPresenter
      period={period}
      pages={pages}
      gender={gender}
      coverageNote={
        currentPartial && !remoteOk && log.since
          ? `From ${dayMonth(log.since)}, when this phone started keeping your history.`
          : null
      }
      onPeriod={setPeriod}
      onClose={() => router.back()}
      onShare={(page) => {
        void Share.share({ message: recapShareText(page) }).catch(() => {});
      }}
    />
  );
}

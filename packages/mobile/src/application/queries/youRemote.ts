/**
 * The BE-H1 seam (PER-113) for the You page, History and Recap.
 *
 * The phone works the page out from its own training log (offline-first,
 * backend design H). The log only holds workouts finished on this phone
 * since it started keeping one (`StoragePort.getTrainingLogSince`). Older
 * months, the 3-month Recap and a new phone ask the server:
 *
 *   GET /users/me/history?month=YYYY-MM | ?date=YYYY-MM-DD
 *   GET /users/me/recap?period=week|month|3months
 *   GET /users/me/muscle-volume?days=7
 *
 * Every container (You, History, Recap) asks `needsRemote` before trusting
 * a range to the phone and only calls the seam when it's true. Answers are
 * cached by what they cover (`StoragePort.cacheYouRemote`), so a range
 * fetched once still shows offline. With no connection and nothing cached
 * the answer is `unavailable`, and the screens show what the phone holds.
 */

import type { MuscleCreditRow } from "@persistence/training-metrics";
import type { PersonalRecord } from "@/domain/models/record";
import type { WorkoutSession } from "@/domain/models/session";
import type {
  RemoteHistoryDay,
  RemoteHistoryWorkout,
  RemoteMuscleRow,
  RemoteMuscleVolume,
  RemoteRecap,
} from "@/domain/models/trainingReads";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import {
  dayKey,
  lastSevenDays,
  recapWindow,
  type HistoryDayModel,
  type RecapModel,
  type RecapPeriod,
} from "@/domain/services/youPage";
import type { ApiError, Result } from "@/shared/errors";

export type YouRemoteResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable" };

/** Server reads for ranges the phone's training log doesn't cover. */
export interface YouRemoteSource {
  /** Day keys with anything logged in a month (`YYYY-MM`). */
  historyMonth(month: string): Promise<YouRemoteResult<readonly string[]>>;
  /** One History day (`YYYY-MM-DD`) the phone's log doesn't reach. */
  historyDay?(date: string): Promise<YouRemoteResult<RemoteHistoryDay>>;
  /** A recap the phone can't build on its own. */
  recap(period: RecapPeriod): Promise<YouRemoteResult<RemoteRecap>>;
  /** Y1's last 7 days (`GET /users/me/muscle-volume?days=7`). */
  lastSevenDays(): Promise<YouRemoteResult<RemoteMuscleVolume>>;
}

/** No server to ask (signed out): every gap stays a gap. */
export const youRemoteUnavailable: YouRemoteSource = {
  historyMonth: async () => ({ status: "unavailable" }),
  historyDay: async () => ({ status: "unavailable" }),
  recap: async () => ({ status: "unavailable" }),
  lastSevenDays: async () => ({ status: "unavailable" }),
};

/**
 * True when a range starts before the phone began keeping its training
 * log, so the phone alone can't answer it in full. No log yet (`since`
 * null) means nothing is on the phone.
 */
export function needsRemote(since: string | null, from: Date): boolean {
  if (since == null) return true;
  return from.getTime() < Date.parse(since);
}

/**
 * Workouts the server returned for History days, by id, so Y2b can open a
 * workout the phone's log never held. Filled whenever a day is read (from
 * the network or the cache), so it is there before the workout is tapped.
 */
const remoteWorkouts = new Map<string, WorkoutSession>();

/** A workout read from the server for a History day, or null. */
export function remoteWorkout(id: string | undefined): WorkoutSession | null {
  return (id && remoteWorkouts.get(id)) || null;
}

/** The server's History workout as a session the summary carousel reads. */
export function remoteWorkoutSession(
  w: RemoteHistoryWorkout,
  userId: string,
): WorkoutSession {
  return {
    id: w.id,
    userId,
    workoutId: null,
    name: w.name,
    status: "completed",
    startedAt: w.startedAt,
    completedAt: w.completedAt,
    retrospectiveDurationSeconds: w.durationSeconds,
    notes: null,
    exercises: w.exercises.map((e, i) => {
      const id = `${w.id}:${i}`;
      return {
        id,
        sessionId: w.id,
        exerciseId: e.exerciseId,
        exerciseName: e.name,
        sortOrder: i,
        supersetGroup: null,
        isSubstituted: e.isSubstituted,
        originalExerciseId: null,
        notes: null,
        sets: e.sets.map((s, n) => ({
          id: s.id,
          sessionExerciseId: id,
          setNumber: n + 1,
          weightKg: s.weightKg,
          reps: s.reps,
          rpe: null,
          durationSeconds: null,
          distanceMeters: null,
          isCompleted: s.isCompleted,
          completedAt: null,
        })),
      };
    }),
  };
}

/**
 * True when a server answer counts every workout the phone holds for the
 * same window, so showing it hides nothing. A workout finished offline
 * keeps a `local-…` id until it syncs, and the server can't have it yet.
 */
export function serverHolds(
  serverIds: readonly string[] | undefined,
  local: readonly { id: string }[],
): boolean {
  const ids = new Set(serverIds ?? []);
  return local.every((s) => ids.has(s.id));
}

/** Ids of a window's workouts, as one value an effect can depend on. */
export const idsKey = (sessions: readonly { id: string }[]): string =>
  sessions.map((s) => s.id).join(",");

/** Server muscle rows as the shared function's rows. */
export function remoteMuscleRows(
  rows: readonly RemoteMuscleRow[],
): MuscleCreditRow[] {
  return rows.map(({ muscle, ...r }) => ({ group: muscle, ...r }));
}

/** A server History day as the phone's day model. */
export function remoteHistoryDayModel(
  key: string,
  d: RemoteHistoryDay,
): HistoryDayModel {
  return {
    key,
    workouts: d.workouts.map((w) => ({
      id: w.id,
      name: w.name,
      startedAt: w.startedAt,
      totals: {
        durationSeconds: w.durationSeconds,
        volumeKg: w.volumeKg,
        sets: w.sets,
      },
      records: w.records,
    })),
    muscles: remoteMuscleRows(d.muscles),
    totals: d.totals,
  };
}

/** A server recap as the phone's recap model. */
export function remoteRecapModel(r: RemoteRecap, userId: string): RecapModel {
  return {
    period: r.period,
    totals: r.totals,
    previous: r.previous,
    muscles: remoteMuscleRows(r.muscles),
    lifts: r.lifts,
    volume: r.volume,
    records: r.records.map(
      (rec, i): PersonalRecord => ({
        id: `remote:${rec.exerciseId}:${rec.recordType}:${i}`,
        userId,
        exerciseId: rec.exerciseId,
        exerciseName: rec.exerciseName,
        recordType: rec.recordType,
        value: rec.value,
        achievedAt: rec.achievedAt,
        sessionId: rec.sessionId,
        setId: null,
      }),
    ),
    together: r.together,
  };
}

/**
 * The live seam: ask the server, keep the answer by what it covers, and
 * fall back to the kept answer when the server can't be reached. Every key
 * names the dates it covers (a recap or week by the day it starts), so an
 * answer kept for last month or last week is never shown as this one.
 */
export function createYouRemoteSource(
  api: ApiPort,
  storage: StoragePort,
  userId: string,
  now: () => Date = () => new Date(),
): YouRemoteSource {
  async function read<T>(
    key: string,
    call: () => Promise<Result<T, ApiError>>,
  ): Promise<YouRemoteResult<T>> {
    const res = await Promise.resolve()
      .then(call)
      .catch(() => null);
    if (res?.ok) {
      storage.cacheYouRemote(userId, key, res.value);
      return { status: "ok", data: res.value };
    }
    const hit = storage.getCachedYouRemote(userId, key);
    return hit
      ? { status: "ok", data: hit.payload as T }
      : { status: "unavailable" };
  }

  return {
    async historyMonth(month) {
      const r = await read(`month:${month}`, () => api.getHistoryMonth(month));
      return r.status === "ok" ? { status: "ok", data: r.data.loggedDays } : r;
    },
    async historyDay(date) {
      const r = await read(`day:${date}`, () => api.getHistoryDay(date));
      if (r.status === "ok")
        for (const w of r.data.workouts)
          remoteWorkouts.set(w.id, remoteWorkoutSession(w, userId));
      return r;
    },
    recap: (period) =>
      read(`recap:${period}:${dayKey(recapWindow(period, now()).from)}`, () =>
        api.getRecap(period),
      ),
    lastSevenDays: () =>
      read(`week:${dayKey(lastSevenDays(now()).from)}`, () =>
        api.getMuscleVolume(7),
      ),
  };
}

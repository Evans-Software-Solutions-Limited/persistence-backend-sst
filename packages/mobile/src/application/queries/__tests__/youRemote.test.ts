import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type {
  RemoteMuscleVolume,
  RemoteRecap,
} from "@/domain/models/trainingReads";
import {
  remoteChestRow,
  remoteDayFixture,
  remoteTotals,
  remoteWorkoutFixture,
} from "./youRemoteFixtures";
import type { ApiPort } from "@/domain/ports/api.port";
import {
  createYouRemoteSource,
  needsRemote,
  remoteHistoryDayModel,
  remoteMuscleRows,
  remoteRecapModel,
  remoteWorkout,
  remoteWorkoutSession,
  youRemoteUnavailable,
} from "../youRemote";

const totals = remoteTotals;
const chest = remoteChestRow;

const week: RemoteMuscleVolume = {
  days: 7,
  from: "2026-11-15",
  to: "2026-11-21",
  timezone: "Europe/London",
  bodyType: "male",
  muscles: [chest],
  trainNext: ["chest"],
  rest: [],
  totals,
  topLifts: [],
  asOf: "x",
};

const recap: RemoteRecap = {
  period: "3months",
  timezone: "Europe/London",
  from: "2026-09-01",
  to: "2026-11-21",
  previousFrom: "2026-06-01",
  previousTo: "2026-08-31",
  totals,
  previous: { ...totals, workouts: 0 },
  muscles: [chest],
  lifts: [],
  volume: [{ exerciseId: "bench", name: "Bench press", volumeKg: 500 }],
  records: [
    {
      exerciseId: "bench",
      exerciseName: "Bench press",
      recordType: "1rm",
      value: 100,
      achievedAt: "2026-09-14T07:20:00.000Z",
      sessionId: "srv-1",
    },
  ],
  together: { sessions: 0, names: [] },
  asOf: "x",
};

describe("youRemote (BE-H1 seam)", () => {
  it("answers unavailable when there's no server to ask", async () => {
    await expect(youRemoteUnavailable.historyMonth("2026-10")).resolves.toEqual(
      { status: "unavailable" },
    );
    await expect(
      youRemoteUnavailable.historyDay!("2026-10-01"),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(youRemoteUnavailable.recap("3months")).resolves.toEqual({
      status: "unavailable",
    });
    await expect(youRemoteUnavailable.lastSevenDays()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("needs the server for ranges before the phone's log", () => {
    const since = "2026-11-20T10:00:00.000Z";
    expect(needsRemote(since, new Date("2026-11-01T00:00:00Z"))).toBe(true);
    expect(needsRemote(since, new Date("2026-11-21T00:00:00Z"))).toBe(false);
    expect(needsRemote(null, new Date())).toBe(true);
  });
});

describe("createYouRemoteSource", () => {
  function setup() {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    return { api, storage, source: createYouRemoteSource(api, storage, "u1") };
  }

  it("reads each route, keeping the answer by what it covers", async () => {
    const { api, storage, source } = setup();
    api.historyMonths.set("2026-09", {
      month: "2026-09",
      timezone: "Europe/London",
      from: "2026-09-01",
      to: "2026-09-30",
      loggedDays: ["2026-09-14"],
      days: [],
      asOf: "x",
    });
    api.historyDays.set("2026-09-14", remoteDayFixture);
    api.recaps.set("3months", recap);
    api.muscleVolume.set(7, week);

    await expect(source.historyMonth("2026-09")).resolves.toEqual({
      status: "ok",
      data: ["2026-09-14"],
    });
    await expect(source.historyDay!("2026-09-14")).resolves.toEqual({
      status: "ok",
      data: remoteDayFixture,
    });
    await expect(source.recap("3months")).resolves.toEqual({
      status: "ok",
      data: recap,
    });
    await expect(source.lastSevenDays()).resolves.toEqual({
      status: "ok",
      data: week,
    });
    expect(storage.getCachedYouRemote("u1", "recap:3months")?.payload).toEqual(
      recap,
    );
    expect(storage.getCachedYouRemote("u1", "week")?.payload).toEqual(week);
    // Another user's cache is separate.
    expect(storage.getCachedYouRemote("u2", "week")).toBeNull();
  });

  it("falls back to the kept answer offline, and to unavailable with none", async () => {
    const { api, storage, source } = setup();
    storage.cacheYouRemote("u1", "recap:month", recap);
    api.shouldFail = true;
    await expect(source.recap("month")).resolves.toEqual({
      status: "ok",
      data: recap,
    });
    await expect(source.historyMonth("2026-09")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("survives an API call that throws", async () => {
    const storage = new InMemoryStorageAdapter();
    const api = {
      getMuscleVolume: () => {
        throw new Error("boom");
      },
    } as unknown as ApiPort;
    const source = createYouRemoteSource(api, storage, "u1");
    await expect(source.lastSevenDays()).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("remembers a day's workouts so Y2b can open them", async () => {
    const { api, source } = setup();
    expect(remoteWorkout("never-read")).toBeNull();
    expect(remoteWorkout(undefined)).toBeNull();
    api.historyDays.set("2026-09-14", remoteDayFixture);
    await source.historyDay!("2026-09-14");
    expect(remoteWorkout("srv-1")).toMatchObject({
      id: "srv-1",
      name: "Upper A",
      status: "completed",
      retrospectiveDurationSeconds: 600,
    });
  });
});

describe("converters", () => {
  it("turns a server workout into a session the summary reads", () => {
    const s = remoteWorkoutSession(remoteWorkoutFixture, "u1");
    expect(s.userId).toBe("u1");
    expect(s.exercises[0]).toMatchObject({
      exerciseId: "bench",
      exerciseName: "Bench press",
      sortOrder: 0,
    });
    expect(s.exercises[0]!.sets[0]).toMatchObject({
      id: "set-1",
      setNumber: 1,
      weightKg: 100,
      reps: 5,
      isCompleted: true,
      sessionExerciseId: s.exercises[0]!.id,
    });
  });

  it("maps muscle rows, a day and a recap to the phone's models", () => {
    expect(remoteMuscleRows([chest])[0]).toEqual({
      group: "chest",
      label: "Chest",
      credit: 5,
      hardSets: 5,
      weeklyGuide: 10,
      ratio: 0.5,
      share: 100,
      level: 3,
    });
    const day = remoteHistoryDayModel("2026-09-14", remoteDayFixture);
    expect(day.workouts[0]).toEqual({
      id: "srv-1",
      name: "Upper A",
      startedAt: "2026-09-14T07:10:00.000Z",
      totals: { durationSeconds: 600, volumeKg: 500, sets: 5 },
      records: 1,
    });
    expect(day.totals).toEqual(totals);
    const model = remoteRecapModel(recap, "u1");
    expect(model.records[0]).toMatchObject({
      userId: "u1",
      exerciseId: "bench",
      value: 100,
      sessionId: "srv-1",
      setId: null,
    });
    expect(model.volume).toEqual(recap.volume);
    expect(model.muscles[0]!.group).toBe("chest");
  });
});

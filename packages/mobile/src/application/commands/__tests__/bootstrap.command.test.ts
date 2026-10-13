import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import {
  forgetBootstrapSections,
  recallBootstrapSection,
} from "@/application/bootstrap/freshness";
import { BOOTSTRAP_SECTION_KEYS } from "@/domain/models/bootstrap";
import { fail } from "@/shared/errors";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";
import { runBootstrap, staleBootstrapSections } from "../bootstrap.command";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const USER = "u-1";
const NOW = 1_800_000_000_000;

function setup() {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const auth = new InMemoryAuthAdapter();
  const queryClient = {
    setQueryData: jest.fn(),
    getQueryState: jest.fn(() => undefined),
  };
  api.profilePage = {
    profile: { id: USER, fullName: "Ada", weightUnit: "kg" },
    subscription: null,
    stats: { workoutsCompleted: 1 },
    recentAchievements: [],
    activeTrainers: [],
    pendingTrainerRequests: [],
  } as never;
  api.mySubscription = { tierName: "free", workoutLimit: 3 } as never;
  api.notifications = [makeNotification({ id: "n1", readAt: null })];
  api.notificationsUnreadCount = 2;
  api.habitCompletions = [
    { id: "hc1", goalId: "g1", localCompletedDate: "2026-10-12" },
    {
      id: "derived-gym-2026-10-12",
      goalId: "g2",
      localCompletedDate: "2026-10-12",
    },
  ] as never;
  return { api, storage, auth, queryClient };
}

afterEach(() => forgetBootstrapSections(USER));

describe("staleBootstrapSections", () => {
  it("always asks for the hardcoded-stale sections and adds the TTL-gated ones when stale", () => {
    const { storage, queryClient } = setup();
    const sections = staleBootstrapSections(storage, USER, queryClient, NOW);
    expect(sections).toEqual(
      expect.arrayContaining([
        "notifications",
        "habitConfig",
        "habitCompletions",
        "streaks",
        "achievements",
        "volumeStats",
        "bodyTrend",
        "recentPRs",
        "home",
        "profile",
        "workouts",
        "muscleGroups",
        "equipment",
        "subscription",
        "tiers",
      ]),
    );
    expect(sections).not.toContain("onboarding");
  });

  it("skips sections whose caches or queries are already fresh", () => {
    const { storage, queryClient } = setup();
    storage.cacheHome(USER, { recentPRs: [] } as never);
    storage.cacheProfilePage(USER, { profile: { fullName: "A" } } as never);
    for (const type of ["mine", "assigned", "default"] as const)
      storage.cacheWorkoutsList(USER, type, [], null);
    storage.cacheReferenceList("muscle_groups", []);
    storage.cacheReferenceList("equipment", []);
    queryClient.getQueryState.mockImplementation(
      () => ({ data: { tierName: "free" } }) as never,
    );
    const sections = staleBootstrapSections(
      storage,
      USER,
      queryClient,
      Date.now(),
    );
    for (const key of [
      "home",
      "profile",
      "workouts",
      "muscleGroups",
      "equipment",
      "subscription",
      "tiers",
    ])
      expect(sections).not.toContain(key);
    expect(sections).toContain("streaks");
  });
});

describe("runBootstrap", () => {
  it("asks for the stale sections once and writes each one the way its hook does", async () => {
    const { api, storage, auth, queryClient } = setup();
    const result = await runBootstrap({
      api,
      storage,
      auth,
      userId: USER,
      ownerLibraryOnly: true,
      queryClient,
      now: () => NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(api.getBootstrapCalls).toHaveLength(1);
    expect(api.getBootstrapCalls[0].ownerLibraryOnly).toBe(true);
    expect(result.value.failed).toEqual([]);
    expect(result.value.applied).toEqual(result.value.requested);

    expect(storage.getCachedHome(USER)).toBeTruthy();
    expect(storage.getCachedProfilePage(USER)?.payload).toBeTruthy();
    expect(storage.getCachedWorkoutsList(USER, "mine")).toBeTruthy();
    expect(storage.getCachedStreaks(USER)).toBeTruthy();
    expect(storage.getCachedAchievements(USER)).toBeTruthy();
    expect(storage.getCachedVolumeStats(USER)).toBeTruthy();
    expect(storage.getCachedBodyTrend(USER)).toBeTruthy();
    expect(storage.getCachedReferenceList("muscle_groups")).toBeTruthy();
    expect(storage.getCachedReferenceList("equipment")).toBeTruthy();
    expect(storage.getCachedUnreadCount()).toBe(1);
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      ["user-subscription", USER],
      api.mySubscription,
    );
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      ["subscription-tiers"],
      expect.any(Array),
    );

    // Stashed for the hooks that keep part of their result in memory.
    expect(
      recallBootstrapSection<number>(USER, "notifications", 60_000, NOW)?.value,
    ).toBe(2);
    expect(
      recallBootstrapSection<{ id: string }[]>(
        USER,
        "habitCompletions",
        60_000,
        NOW,
      )?.value,
    ).toEqual([expect.objectContaining({ id: "derived-gym-2026-10-12" })]);
    expect(
      storage
        .getCachedHabitCompletions(USER, { since: "2026-10-01" })
        .map((r) => r.id),
    ).toEqual(["hc1"]);
    expect(recallBootstrapSection(USER, "home", 60_000, NOW)).toBeTruthy();
    expect(
      recallBootstrapSection(USER, "home", 60_000, NOW + 61_000),
    ).toBeNull();
  });

  it("sends nothing when nothing is stale and honours an explicit include", async () => {
    const { api, storage, auth, queryClient } = setup();
    const none = await runBootstrap({
      api,
      storage,
      auth,
      userId: USER,
      ownerLibraryOnly: false,
      queryClient,
      include: [],
    });
    expect(none).toEqual({
      ok: true,
      value: { requested: [], applied: [], failed: [] },
    });
    expect(api.getBootstrapCalls).toHaveLength(0);
    const some = await runBootstrap({
      api,
      storage,
      auth,
      userId: USER,
      ownerLibraryOnly: false,
      queryClient,
      include: ["streaks"],
    });
    expect(some.ok && some.value.applied).toEqual(["streaks"]);
    expect(api.getBootstrapCalls[0].include).toEqual(["streaks"]);
    expect(storage.getCachedHome(USER)).toBeFalsy();
  });

  it("reports a failed or missing section without touching its cache and surfaces a failed request", async () => {
    const { api, storage, auth, queryClient } = setup();
    const real = api.getBootstrap.bind(api);
    jest.spyOn(api, "getBootstrap").mockImplementation(async (params) => {
      const result = await real(params);
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          ...result.value,
          sections: {
            ...result.value.sections,
            streaks: { ok: false, error: "db down" },
            achievements: undefined,
          },
        },
      };
    });
    const result = await runBootstrap({
      api,
      storage,
      auth,
      userId: USER,
      ownerLibraryOnly: false,
      queryClient,
      include: ["streaks", "achievements", "home"],
    });
    expect(result.ok && result.value).toEqual({
      requested: ["streaks", "achievements", "home"],
      applied: ["home"],
      failed: [
        { section: "streaks", error: "db down" },
        { section: "achievements", error: "missing" },
      ],
    });
    expect(storage.getCachedStreaks(USER)).toEqual([]);
    expect(recallBootstrapSection(USER, "streaks", 60_000)).toBeNull();

    api.shouldFail = true;
    api.failError = {
      kind: "api",
      code: "server",
      message: "503",
      status: 503,
    };
    const failed = await runBootstrap({
      api,
      storage,
      auth,
      userId: USER,
      ownerLibraryOnly: false,
      queryClient,
      include: ["home"],
    });
    expect(failed).toEqual(
      fail({ kind: "api", code: "server", message: "503", status: 503 }),
    );
    expect(BOOTSTRAP_SECTION_KEYS).toContain("home");
  });
});

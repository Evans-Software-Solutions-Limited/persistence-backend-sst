/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const authState: { user: { sub: string } | null } = {
  user: { sub: "user-123" },
};

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async () => authState.user),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { error: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx: any) => ctx.user),
}));

// Keep this mock trivial — repository tests cover DB interactions.
// The handler suite only needs to confirm the envelope, auth plumbing,
// and that the thin wrapper doesn't reshape the payload.
vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([]),
            leftJoin: () => ({
              where: () => ({
                orderBy: () => ({ limit: () => Promise.resolve([]) }),
              }),
            }),
          }),
          then: (cb: any) => Promise.resolve([]).then(cb),
        }),
      }),
    }),
  })),
}));

import { dashboardHandler } from "../dashboardHandler";
import {
  DashboardRepository,
  pickPROfTheWeek,
  type DashboardData,
} from "../../repositories/dashboardRepository";

describe("dashboardHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { sub: "user-123" };
  });

  it("returns 200 and a single-envelope payload for an authenticated user", async () => {
    const stub: DashboardData = {
      profile: {
        id: "user-123",
        fullName: "Grace Hopper",
        firstName: "Grace",
        preferredUnits: "metric",
      },
      subscription: {
        tierName: "pro",
        isFreeTier: false,
        isTrainerTier: false,
        status: "active",
      },
      recentWorkouts: [
        {
          id: "w-1",
          name: "Leg Day",
          description: null,
          estimatedDurationMinutes: 45,
          createdBy: "user-123",
          isAssigned: false,
          assignedByType: null,
        },
      ],
      recentActivity: [
        {
          workoutSessionId: "s-1",
          workoutId: "w-1",
          workoutName: "Leg Day",
          completedAt: "2026-04-22T10:00:00.000Z",
          durationSeconds: 3600,
        },
      ],
      progress: {
        workoutsThisMonth: 3,
        workoutsLastMonth: 5,
        streak: 2,
        personalRecordsCount: 1,
      },
      prOfTheWeek: {
        exerciseId: "ex-1",
        exerciseName: "Back Squat",
        recordType: "1rm",
        value: 120,
        unit: "kg",
        achievedAt: "2026-04-21T10:00:00.000Z",
      },
      latestMeasurement: {
        id: "m-1",
        weightKg: 75.5,
        bodyFatPercentage: 15.0,
        measuredAt: "2026-04-20T10:00:00.000Z",
      },
      activeProgramme: null,
    };

    const spy = vi
      .spyOn(DashboardRepository.prototype, "getDashboard")
      .mockResolvedValue(stub);

    const response = await dashboardHandler.handle(
      new Request("http://localhost/dashboard", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: any };

    // AC 5.8: single-envelope. Not a double-envelope with {data: {data, meta}}.
    expect(body).toHaveProperty("data");
    expect(body.data).toMatchObject({
      profile: { firstName: "Grace" },
      subscription: { isFreeTier: false },
      progress: { streak: 2 },
      prOfTheWeek: { recordType: "1rm", value: 120 },
    });
    // No nested `data` under the payload.
    expect(body.data.data).toBeUndefined();
    expect(spy).toHaveBeenCalledWith("user-123");
    spy.mockRestore();
  });

  it("returns numeric latestMeasurement fields (not Drizzle strings)", async () => {
    vi.spyOn(DashboardRepository.prototype, "getDashboard").mockResolvedValue({
      profile: {
        id: "user-123",
        fullName: null,
        firstName: null,
        preferredUnits: "metric",
      },
      subscription: {
        tierName: null,
        isFreeTier: true,
        isTrainerTier: false,
        status: null,
      },
      recentWorkouts: [],
      recentActivity: [],
      progress: {
        workoutsThisMonth: 0,
        workoutsLastMonth: 0,
        streak: 0,
        personalRecordsCount: 0,
      },
      prOfTheWeek: {
        exerciseId: "ex-1",
        exerciseName: "Back Squat",
        recordType: "1rm",
        value: 120.5,
        unit: "kg",
        achievedAt: "2026-04-21T10:00:00.000Z",
      },
      latestMeasurement: {
        id: "m-1",
        weightKg: 75.5,
        bodyFatPercentage: 15.0,
        measuredAt: "2026-04-20T10:00:00.000Z",
      },
      activeProgramme: null,
    });

    const response = await dashboardHandler.handle(
      new Request("http://localhost/dashboard", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    const body = (await response.json()) as { data: any };
    expect(typeof body.data.latestMeasurement.weightKg).toBe("number");
    expect(typeof body.data.latestMeasurement.bodyFatPercentage).toBe("number");
    expect(typeof body.data.prOfTheWeek.value).toBe("number");
  });

  it("returns 401 when no authenticated user is attached to the request", async () => {
    authState.user = null;

    const response = await dashboardHandler.handle(
      new Request("http://localhost/dashboard", {
        method: "GET",
        headers: {},
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns an empty-state payload for a user with no data", async () => {
    vi.spyOn(DashboardRepository.prototype, "getDashboard").mockResolvedValue({
      profile: {
        id: "user-123",
        fullName: null,
        firstName: null,
        preferredUnits: "metric",
      },
      subscription: {
        tierName: null,
        isFreeTier: true,
        isTrainerTier: false,
        status: null,
      },
      recentWorkouts: [],
      recentActivity: [],
      progress: {
        workoutsThisMonth: 0,
        workoutsLastMonth: 0,
        streak: 0,
        personalRecordsCount: 0,
      },
      prOfTheWeek: null,
      latestMeasurement: null,
      activeProgramme: null,
    });

    const response = await dashboardHandler.handle(
      new Request("http://localhost/dashboard", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: any };

    // AC 7.1 — every top-level field present, empty collections are [],
    // absent objects are null; never missing keys.
    expect(body.data.recentWorkouts).toEqual([]);
    expect(body.data.recentActivity).toEqual([]);
    expect(body.data.prOfTheWeek).toBeNull();
    expect(body.data.latestMeasurement).toBeNull();
    expect(body.data.subscription.isFreeTier).toBe(true);
  });

  it("PR-of-the-week tie-break is deterministic: same window, same winner", () => {
    // Handler-level coverage of AC 7.6 via the same helper the repo calls.
    const when = new Date("2026-04-22T12:00:00Z");
    const fiveRm = {
      id: "pr-a",
      exerciseId: "ex-1",
      recordType: "5rm" as const,
      value: 100,
      achievedAt: when,
    };
    const oneRm = {
      id: "pr-b",
      exerciseId: "ex-2",
      recordType: "1rm" as const,
      value: 110,
      achievedAt: when,
    };

    expect(pickPROfTheWeek([fiveRm, oneRm])?.id).toBe("pr-b");
    expect(pickPROfTheWeek([oneRm, fiveRm])?.id).toBe("pr-b");
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (hoisted) ─────────────────────────────────────────────────────────

const gateMock = vi.hoisted(() =>
  vi.fn(async () => ({ allowed: true }) as any),
);
const assertEntitlementMock = vi.hoisted(() =>
  vi.fn(async () => ({ allowed: true }) as any),
);
const generateSummaryMock = vi.hoisted(() =>
  vi.fn(
    async () => "Solid week — hit calories 4/6 logged days. Focus: protein.",
  ),
);
const getForDayMock = vi.hoisted(() => vi.fn(async () => null as any));
const insertInitialMock = vi.hoisted(() => vi.fn(async () => true));
const updateRefreshMock = vi.hoisted(() => vi.fn(async () => undefined));
const countForUserTodayMock = vi.hoisted(() => vi.fn(async () => 0));
const recordMock = vi.hoisted(() => vi.fn(async () => undefined));
const getClientDetailMock = vi.hoisted(() =>
  vi.fn(async () => CLIENT_DETAIL_FIXTURE),
);
const auditClientDataReadMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "trainer-1",
      email: "coach@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "trainer-1" }),
}));

vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: gateMock,
}));

vi.mock("../../../relationships/auditClientDataRead", () => ({
  auditClientDataRead: auditClientDataReadMock,
}));

vi.mock("../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../entitlement/assertEntitlement")
  >("../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: assertEntitlementMock };
});

vi.mock("../../services/clientSummaryAi", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/clientSummaryAi")
  >("../../services/clientSummaryAi");
  return {
    ...actual,
    generateClientSummary: generateSummaryMock,
    resolveSummaryModelId: () => "eu.anthropic.test-model",
  };
});

vi.mock("../../../repositories/clientAiSummaryRepository", async () => {
  const actual = await vi.importActual<
    typeof import("../../../repositories/clientAiSummaryRepository")
  >("../../../repositories/clientAiSummaryRepository");
  return {
    ...actual, // keep AI_COACH_SUMMARY_ENDPOINT + AI_COACH_SUMMARY_DAILY_LIMIT
    ClientAiSummaryRepository: vi.fn(() => ({
      getForDay: getForDayMock,
      insertInitial: insertInitialMock,
      updateRefresh: updateRefreshMock,
    })),
  };
});

vi.mock("../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn(() => ({
    countForUserToday: countForUserTodayMock,
    record: recordMock,
  })),
}));

vi.mock("../../../repositories/clientDetailRepository", () => ({
  ClientDetailRepository: vi.fn(() => ({
    getClientDetail: getClientDetailMock,
  })),
}));

// getDb serves only resolveClientTz's profiles read here.
vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ tz: "Europe/London" }],
        }),
      }),
    }),
  })),
}));

const CLIENT_DETAIL_FIXTURE = {
  client: { name: "Jane Doe" },
  adherence: { overall: 82, band: "strong", categories: [] },
  prs: [
    {
      type: "1rm",
      exerciseName: "Bench",
      value: 100,
      unit: "kg",
      achievedAt: null,
    },
  ],
  volume: { weekKg: 12400, daily: [] },
  calorieHit: {
    targetKcal: 2000,
    daysHit: 4,
    daysLogged: 6,
    todayKcal: 500,
    todayRemainingKcal: 1500,
  },
  goal: {
    id: "g1",
    title: "Lose weight",
    unit: "kg",
    targetDate: null,
    assignedByCoach: true,
    weight: { startKg: 90, nowKg: 85, targetKg: 80 },
    pct: 0.5,
  },
  habits: {
    habits: [
      { goalId: "h1", label: "Water", category: "water", met: true, pct: 1 },
    ],
    collectionStreak: 3,
    collectionSatisfied: false,
  },
  aiSummary: {
    summary: null,
    coversDate: null,
    generatedAt: null,
    canManualRefresh: false,
  },
  thisWeek: {
    workoutsCompleted: 3,
    workoutsPlanned: 4,
    volumeKg: 12400,
    prs: 1,
    checkIns: null,
  },
  recentSessions: [],
  notes: [],
} as any;

const CACHED_ROW = {
  id: "sum-1",
  summary: "Cached summary text.",
  model: "eu.anthropic.test-model",
  refreshCount: 0,
  generatedAt: "2026-07-08T06:00:00.000Z",
};

function authedRequest(body?: unknown) {
  return new Request(
    "http://localhost/trainers/me/clients/client-1/ai-summary",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify(body ?? {}),
    },
  );
}

async function json(res: Response): Promise<any> {
  return (await res.json()) as any;
}

async function buildApp() {
  const { default: Elysia } = await import("elysia");
  const { coreErrorHandler } = await import("../../../../shared/errorHandler");
  const { trainersMeGenerateClientAiSummaryHandler } =
    await import("../trainersMeGenerateClientAiSummaryHandler");
  return new Elysia()
    .use(coreErrorHandler)
    .use(trainersMeGenerateClientAiSummaryHandler);
}

describe("trainersMeGenerateClientAiSummaryHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gateMock.mockResolvedValue({ allowed: true });
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    getForDayMock.mockResolvedValue(null);
    countForUserTodayMock.mockResolvedValue(0);
    generateSummaryMock.mockResolvedValue(
      "Solid week — hit calories 4/6 logged days. Focus: protein.",
    );
    getClientDetailMock.mockResolvedValue(CLIENT_DETAIL_FIXTURE);
    // Reset write implementations too — clearAllMocks clears call history but
    // NOT implementations set via mockRejectedValue in a prior test.
    insertInitialMock.mockResolvedValue(true);
    updateRefreshMock.mockResolvedValue(undefined);
    recordMock.mockResolvedValue(undefined);
    auditClientDataReadMock.mockResolvedValue(undefined);
  });

  it("401 when unauthenticated — never reaches the gate", async () => {
    const app = await buildApp();
    const res = await app.handle(
      new Request("http://localhost/trainers/me/clients/client-1/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
    expect(gateMock).not.toHaveBeenCalled();
  });

  it("403 when the trainer gate denies (wrong role / not their client)", async () => {
    gateMock.mockResolvedValue({
      allowed: false,
      reason: "wrong_role",
      status: 403,
      body: { code: "not_a_trainer", message: "no" },
    });
    const app = await buildApp();
    const res = await app.handle(authedRequest());
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe("not_a_trainer");
    expect(generateSummaryMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("402 when the coach lacks ai_access (entitlement denied)", async () => {
    assertEntitlementMock.mockResolvedValue({
      allowed: false,
      reason: "tier",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
    });
    const app = await buildApp();
    const res = await app.handle(authedRequest());
    expect(res.status).toBe(402);
    expect(generateSummaryMock).not.toHaveBeenCalled();
    // No data was read, so no read-audit row is written.
    expect(auditClientDataReadMock).not.toHaveBeenCalled();
  });

  it("429 ai_daily_limit when the coach is at the per-coach ceiling", async () => {
    countForUserTodayMock.mockResolvedValue(40); // the default ceiling
    const app = await buildApp();
    const res = await app.handle(authedRequest());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "ai_daily_limit" });
    expect(generateSummaryMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
    // At-ceiling: no data read, so no read-audit row.
    expect(auditClientDataReadMock).not.toHaveBeenCalled();
  });

  it("no row → auto-generates, inserts refresh_count=0, records usage, canManualRefresh true", async () => {
    getForDayMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.handle(authedRequest({ manual: false }));
    expect(res.status).toBe(200);
    const body = (await json(res)).data;
    expect(body.summary).toContain("Solid week");
    expect(body.canManualRefresh).toBe(true);
    expect(insertInitialMock).toHaveBeenCalledTimes(1);
    expect(updateRefreshMock).not.toHaveBeenCalled();
    // Privacy: the generation input carries totals/adherence, never a food log.
    const input = (generateSummaryMock.mock.calls[0] as any[])[0];
    expect(JSON.stringify(input)).not.toContain("entries");
    expect(input.clientName).toBe("Jane Doe");
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect((recordMock.mock.calls[0] as any[])[0].endpoint).toBe(
      "/trainers/me/clients/:clientId/ai-summary",
    );
  });

  it("concurrent open lost the insert race → returns the winner's cached row, not a 500", async () => {
    getForDayMock
      .mockResolvedValueOnce(null) // row-state check sees no row
      .mockResolvedValueOnce({
        ...CACHED_ROW,
        summary: "Winner's summary.",
        refreshCount: 0,
      }); // re-read after the conflicting insert no-ops
    insertInitialMock.mockResolvedValue(false); // UNIQUE conflict → someone won
    const app = await buildApp();
    const res = await app.handle(authedRequest({ manual: false }));
    expect(res.status).toBe(200);
    const body = (await json(res)).data;
    expect(body.summary).toBe("Winner's summary.");
    expect(body.canManualRefresh).toBe(true);
    // We still spent an inference (honest), so it is recorded.
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it("no row + manual=true still takes the auto path (nothing to refresh yet)", async () => {
    getForDayMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.handle(authedRequest({ manual: true }));
    expect(res.status).toBe(200);
    expect(insertInitialMock).toHaveBeenCalledTimes(1);
    expect(updateRefreshMock).not.toHaveBeenCalled();
  });

  it("row exists + manual=true + refresh unused → regenerates, updateRefresh, canManualRefresh false", async () => {
    getForDayMock.mockResolvedValue({ ...CACHED_ROW, refreshCount: 0 });
    const app = await buildApp();
    const res = await app.handle(authedRequest({ manual: true }));
    expect(res.status).toBe(200);
    const body = (await json(res)).data;
    expect(body.canManualRefresh).toBe(false); // the one refresh is now spent
    expect(updateRefreshMock).toHaveBeenCalledTimes(1);
    expect(insertInitialMock).not.toHaveBeenCalled();
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it("row exists + manual=true + refresh already spent (count≥1) → cached, NO inference", async () => {
    getForDayMock.mockResolvedValue({ ...CACHED_ROW, refreshCount: 1 });
    const app = await buildApp();
    const res = await app.handle(authedRequest({ manual: true }));
    expect(res.status).toBe(200);
    const body = (await json(res)).data;
    expect(body.summary).toBe("Cached summary text.");
    expect(body.canManualRefresh).toBe(false);
    expect(generateSummaryMock).not.toHaveBeenCalled();
    expect(insertInitialMock).not.toHaveBeenCalled();
    expect(updateRefreshMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("row exists + manual=false (auto re-open) → returns cached, NO inference", async () => {
    getForDayMock.mockResolvedValue({ ...CACHED_ROW, refreshCount: 0 });
    countForUserTodayMock.mockResolvedValue(2);
    const app = await buildApp();
    const res = await app.handle(authedRequest({ manual: false }));
    expect(res.status).toBe(200);
    const body = (await json(res)).data;
    expect(body.summary).toBe("Cached summary text.");
    expect(body.canManualRefresh).toBe(true); // unused + under ceiling
    expect(generateSummaryMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("503 ai_unavailable on Bedrock failure — usage still recorded, NO cache write", async () => {
    const { ClientSummaryUnavailableError } =
      await import("../../services/clientSummaryAi");
    generateSummaryMock.mockRejectedValue(
      new ClientSummaryUnavailableError("provider down"),
    );
    const app = await buildApp();
    const res = await app.handle(authedRequest({ manual: false }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai_unavailable" });
    expect(insertInitialMock).not.toHaveBeenCalled();
    expect(updateRefreshMock).not.toHaveBeenCalled();
    // The model was reached → the attempt is counted (didInfer).
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it("a usage-log write failure never fails the user-facing 200", async () => {
    recordMock.mockRejectedValue(new Error("log db down"));
    const app = await buildApp();
    const res = await app.handle(authedRequest({ manual: false }));
    expect(res.status).toBe(200);
    expect(insertInitialMock).toHaveBeenCalledTimes(1);
  });

  it("body is optional — no body defaults to the auto path", async () => {
    const app = await buildApp();
    const res = await app.handle(
      new Request("http://localhost/trainers/me/clients/client-1/ai-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer test-token",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(insertInitialMock).toHaveBeenCalledTimes(1);
  });

  it("logs a coach read-audit row (category=ai_summary) after the gate passes", async () => {
    const app = await buildApp();
    const res = await app.handle(authedRequest());
    expect(res.status).toBe(200);
    expect(auditClientDataReadMock).toHaveBeenCalledWith({
      trainerId: "trainer-1",
      clientId: "client-1",
      dataCategory: "ai_summary",
      route: "/trainers/me/clients/:clientId/ai-summary",
    });
  });

  it("still returns 200 if the read-audit write throws", async () => {
    auditClientDataReadMock.mockRejectedValue(new Error("audit db down"));
    const app = await buildApp();
    const res = await app.handle(authedRequest());
    expect(res.status).toBe(200);
  });
});

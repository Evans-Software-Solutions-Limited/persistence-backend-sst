/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Per-user AI spend budget (spec-29 Phase 1). Allowed by default; a test flips
// `aiBudget.allowed` to prove the 429 path.
const aiBudget = vi.hoisted(() => ({
  allowed: true,
  calls: [] as unknown[][],
}));
vi.mock("../../../ai/aiBudget", () => ({
  AI_BUDGET_EXHAUSTED_BODY: { error: "ai_budget_exhausted" },
  hasAiBudget: async (...args: unknown[]) => {
    aiBudget.calls.push(args);
    return aiBudget.allowed;
  },
}));
afterEach(() => {
  aiBudget.allowed = true;
  aiBudget.calls = [];
});

// ─── Mocks (hoisted) ─────────────────────────────────────────────────────────

const SCOPE = vi.hoisted(() => ({
  trainerId: "trainer-1",
  clientId: "client-1",
  relationshipId: "rel-1",
  activatedAt: "2026-01-05T09:00:00.000Z" as string | null,
  settings: {} as any,
}));
const gateMock = vi.hoisted(() =>
  vi.fn(async () => ({ allowed: true, scope: SCOPE }) as any),
);
const assertEntitlementMock = vi.hoisted(() =>
  vi.fn(async () => ({ allowed: true }) as any),
);
const WEEKLY = vi.hoisted(() => ({
  headline: "Steady week, one session short.",
  areas: [
    { area: "training", status: "check", text: "3 of 4 sessions." },
    { area: "calories", status: "good", text: "4 of 7 days on target." },
  ],
  ask: "Ask what got in the way of the fourth session.",
}));
const EVIDENCE = vi.hoisted(() => ({
  training: { done: 3, target: 4, state: "behind" },
  calories: {
    daysOnTarget: 4,
    daysCounted: 7,
    daysNotLogged: 1,
    daysOver: 1,
    daysUnder: 1,
  },
  programme: { week: 3, of: 8 },
}));
const generateSummaryMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => WEEKLY as any),
);
const loadEvidenceMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => EVIDENCE as any),
);
const getForDayMock = vi.hoisted(() => vi.fn(async () => null as any));
const insertInitialMock = vi.hoisted(() => vi.fn(async () => true));
const updateRefreshMock = vi.hoisted(() => vi.fn(async () => undefined));
const countForUserTodayMock = vi.hoisted(() => vi.fn(async () => 0));
const recordMock = vi.hoisted(() => vi.fn(async () => undefined));
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

vi.mock("../../../relationships/resolveCoachScope", () => ({
  resolveCoachScope: gateMock,
}));

vi.mock("../../services/weeklySummaryEvidenceRepository", () => ({
  loadWeeklySummaryEvidence: loadEvidenceMock,
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
    ClientAiSummaryRepository: vi.fn(function () {
      return {
        getForDay: getForDayMock,
        insertInitial: insertInitialMock,
        updateRefresh: updateRefreshMock,
      };
    }),
  };
});

vi.mock("../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn(function () {
    return {
      countForUserToday: countForUserTodayMock,
      record: recordMock,
    };
  }),
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

const CACHED_ROW = {
  id: "sum-1",
  summary: "Cached summary text.",
  model: "eu.anthropic.test-model",
  refreshCount: 0,
  generatedAt: "2026-07-08T06:00:00.000Z",
  headline: "Cached headline.",
  areas: [{ area: "training", status: "good", text: "4 of 4." }],
  ask: "Cached ask.",
  weekOfProgramme: { week: 2, of: 8 },
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
    gateMock.mockResolvedValue({ allowed: true, scope: SCOPE });
    SCOPE.activatedAt = "2026-01-05T09:00:00.000Z";
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    getForDayMock.mockResolvedValue(null);
    countForUserTodayMock.mockResolvedValue(0);
    generateSummaryMock.mockResolvedValue(WEEKLY);
    loadEvidenceMock.mockResolvedValue(EVIDENCE);
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

  it("429s ai_budget_exhausted when a summary must be generated and the budget is spent", async () => {
    aiBudget.allowed = false;
    getForDayMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.handle(authedRequest());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "ai_budget_exhausted" });
    expect(generateSummaryMock).not.toHaveBeenCalled();
    expect(loadEvidenceMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
    expect(aiBudget.calls.at(-1)?.[1]).toBe(
      "/trainers/me/clients/:clientId/ai-summary",
    );
  });

  it("still serves a cached summary when the budget is spent — a cache hit costs no AI", async () => {
    aiBudget.allowed = false;
    getForDayMock.mockResolvedValue({ ...CACHED_ROW, refreshCount: 1 });
    const app = await buildApp();
    const res = await app.handle(authedRequest());
    expect(res.status).toBe(200);
    expect((await json(res)).data.summary).toEqual(CACHED_ROW.summary);
    expect(generateSummaryMock).not.toHaveBeenCalled();
    expect(aiBudget.calls).toHaveLength(0);
  });

  it("no row → auto-generates the summary by area, inserts refresh_count=0, records usage", async () => {
    getForDayMock.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.handle(authedRequest({ manual: false }));
    expect(res.status).toBe(200);
    const body = (await json(res)).data;
    expect(body.state).toBe("ready");
    expect(body.headline).toBe(WEEKLY.headline);
    expect(body.areas).toEqual(WEEKLY.areas);
    expect(body.ask).toBe(WEEKLY.ask);
    expect(body.weekOfProgramme).toEqual({ week: 3, of: 8 });
    // 1.2.0 bundles: `summary` is the headline and area lines joined.
    const legacy =
      "Steady week, one session short. 3 of 4 sessions. 4 of 7 days on target.";
    expect(body.summary).toBe(legacy);
    expect(body.canManualRefresh).toBe(true);
    expect(insertInitialMock).toHaveBeenCalledTimes(1);
    expect(insertInitialMock).toHaveBeenCalledWith({
      trainerId: "trainer-1",
      clientId: "client-1",
      coversDate: body.coversDate,
      summary: legacy,
      model: "eu.anthropic.test-model",
      headline: WEEKLY.headline,
      areas: WEEKLY.areas,
      ask: WEEKLY.ask,
      weekOfProgramme: { week: 3, of: 8 },
    });
    expect(updateRefreshMock).not.toHaveBeenCalled();
    // The evidence is gathered for this coach's own scope, and only the areas
    // with evidence are offered to the model.
    expect(loadEvidenceMock.mock.calls[0]?.[0]).toBe(SCOPE);
    expect(loadEvidenceMock.mock.calls[0]?.[1]).toBe("Europe/London");
    const [input, allowed] = generateSummaryMock.mock.calls[0] as any[];
    expect(input).toEqual(EVIDENCE);
    expect(allowed).toEqual(["training", "calories"]);
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
    // The facts it would have summarised, never invented text.
    expect(await res.json()).toEqual({
      error: "ai_unavailable",
      facts: EVIDENCE,
    });
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

  it("a cached row from before PER-115 still returns its paragraph, with no areas", async () => {
    getForDayMock.mockResolvedValue({
      ...CACHED_ROW,
      refreshCount: 1,
      headline: null,
      areas: null,
      ask: null,
      weekOfProgramme: null,
    });
    const app = await buildApp();
    const res = await app.handle(authedRequest());
    const body = (await json(res)).data;
    expect(body).toMatchObject({
      state: "ready",
      summary: "Cached summary text.",
      headline: null,
      areas: [],
      ask: null,
      weekOfProgramme: null,
    });
  });

  it("a cached row returns its summary by area", async () => {
    getForDayMock.mockResolvedValue({ ...CACHED_ROW, refreshCount: 1 });
    const app = await buildApp();
    const body = (await json(await app.handle(authedRequest()))).data;
    expect(body.headline).toBe("Cached headline.");
    expect(body.areas).toEqual(CACHED_ROW.areas);
    expect(body.ask).toBe("Cached ask.");
    expect(body.weekOfProgramme).toEqual({ week: 2, of: 8 });
  });

  it("no area has evidence → no AI call, no cache row, summary null (1.2.0 empty state)", async () => {
    loadEvidenceMock.mockResolvedValue({ programme: { week: 1, of: null } });
    const app = await buildApp();
    const res = await app.handle(authedRequest());
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({
      state: "ready",
      summary: null,
      headline: null,
      areas: [],
      canManualRefresh: false,
      weekOfProgramme: { week: 1, of: null },
    });
    expect(generateSummaryMock).not.toHaveBeenCalled();
    expect(insertInitialMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("a relationship with no activated_at has no first-week wait", async () => {
    SCOPE.activatedAt = null;
    const app = await buildApp();
    const res = await app.handle(authedRequest());
    expect((await json(res)).data.state).toBe("ready");
    expect(generateSummaryMock).toHaveBeenCalledTimes(1);
  });

  describe("first week (design B D6 test 6)", () => {
    afterEach(() => vi.useRealTimers());

    // Activation instants (London) → first summary day. Mon 23 Nov 2026 counts
    // its own week; Wed 25 and Sun 29 wait for the week of Mon 30 Nov.
    it.each([
      ["a Monday", "2026-11-23T10:00:00Z", "2026-11-30"],
      ["a Wednesday", "2026-11-25T10:00:00Z", "2026-12-07"],
      ["a Sunday", "2026-11-29T10:00:00Z", "2026-12-07"],
    ])(
      "activated on %s → firstWeek with firstSummaryOn %s, zero AI calls, no quota",
      async (_day, activatedAt, due) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-29T20:00:00Z"));
        SCOPE.activatedAt = activatedAt;
        const app = await buildApp();
        const res = await app.handle(authedRequest({ manual: true }));
        expect(res.status).toBe(200);
        expect((await json(res)).data).toEqual({
          state: "firstWeek",
          firstSummaryOn: due,
          summary: null,
          coversDate: "2026-11-28",
          generatedAt: null,
          canManualRefresh: false,
          headline: null,
          areas: [],
          ask: null,
          weekOfProgramme: null,
        });
        expect(generateSummaryMock).not.toHaveBeenCalled();
        expect(countForUserTodayMock).not.toHaveBeenCalled();
        expect(aiBudget.calls).toHaveLength(0);
        expect(recordMock).not.toHaveBeenCalled();
        expect(getForDayMock).not.toHaveBeenCalled();
        expect(loadEvidenceMock).not.toHaveBeenCalled();
        expect(auditClientDataReadMock).not.toHaveBeenCalled();
      },
    );

    it("on the first summary day itself the summary is generated", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-30T08:00:00Z"));
      SCOPE.activatedAt = "2026-11-23T10:00:00Z";
      const app = await buildApp();
      const res = await app.handle(authedRequest());
      const body = (await json(res)).data;
      expect(body.state).toBe("ready");
      expect(body.coversDate).toBe("2026-11-29");
      expect(generateSummaryMock).toHaveBeenCalledTimes(1);
    });
  });
});

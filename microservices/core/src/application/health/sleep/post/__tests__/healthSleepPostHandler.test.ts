/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sleepMocks = { upsertManual: vi.fn() };

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    !h || !h.startsWith("Bearer ")
      ? null
      : { sub: "test-user-id", email: "t@e.com", iat: 0, exp: 9999999999 },
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));
vi.mock("../../../../repositories/sleepRepository", () => ({
  SleepRepository: vi.fn().mockImplementation(() => sleepMocks),
}));

function post(body: unknown, auth = true) {
  return new Request("http://localhost/health/sleep", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

describe("healthSleepPostHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { healthSleepPostHandler } =
      await import("../healthSleepPostHandler");
    const res = await healthSleepPostHandler.handle(
      post({ sleepDate: "2026-07-16", durationMinutes: 450 }, false),
    );
    expect(res.status).toBe(401);
  });

  it("upserts the manual sleep row and returns the stored record", async () => {
    const stored = {
      id: "s1",
      userId: "test-user-id",
      sleepDate: "2026-07-16",
      durationMinutes: 450,
      dataSource: "manual",
    };
    sleepMocks.upsertManual.mockResolvedValue(stored);
    const { healthSleepPostHandler } =
      await import("../healthSleepPostHandler");
    const res = await healthSleepPostHandler.handle(
      post({ sleepDate: "2026-07-16", durationMinutes: 450 }),
    );
    expect(res.status).toBe(200);
    expect(sleepMocks.upsertManual).toHaveBeenCalledWith("test-user-id", {
      sleepDate: "2026-07-16",
      durationMinutes: 450,
      sleepStart: undefined,
      sleepEnd: undefined,
    });
    expect(((await res.json()) as any).data).toEqual(stored);
  });

  it("parses optional sleepStart/sleepEnd into Dates", async () => {
    sleepMocks.upsertManual.mockResolvedValue({});
    const { healthSleepPostHandler } =
      await import("../healthSleepPostHandler");
    await healthSleepPostHandler.handle(
      post({
        sleepDate: "2026-07-16",
        durationMinutes: 450,
        sleepStart: "2026-07-15T23:30:00.000Z",
        sleepEnd: "2026-07-16T07:00:00.000Z",
      }),
    );
    const call = sleepMocks.upsertManual.mock.calls[0][1];
    expect(call.sleepStart).toBeInstanceOf(Date);
    expect(call.sleepEnd).toBeInstanceOf(Date);
    expect(call.sleepStart.toISOString()).toBe("2026-07-15T23:30:00.000Z");
  });

  it("drops an unparsable sleepStart/sleepEnd rather than 422ing (best-effort HealthKit-mirrored field)", async () => {
    sleepMocks.upsertManual.mockResolvedValue({});
    const { healthSleepPostHandler } =
      await import("../healthSleepPostHandler");
    const res = await healthSleepPostHandler.handle(
      post({
        sleepDate: "2026-07-16",
        durationMinutes: 450,
        sleepStart: "not-a-date",
      }),
    );
    expect(res.status).toBe(200);
    const call = sleepMocks.upsertManual.mock.calls[0][1];
    expect(call.sleepStart).toBeUndefined();
  });

  it("422s durationMinutes = 0 (outside the (0, 1440] range)", async () => {
    const { healthSleepPostHandler } =
      await import("../healthSleepPostHandler");
    const res = await healthSleepPostHandler.handle(
      post({ sleepDate: "2026-07-16", durationMinutes: 0 }),
    );
    expect(res.status).toBe(422);
    expect(sleepMocks.upsertManual).not.toHaveBeenCalled();
  });

  it("422s durationMinutes > 1440", async () => {
    const { healthSleepPostHandler } =
      await import("../healthSleepPostHandler");
    const res = await healthSleepPostHandler.handle(
      post({ sleepDate: "2026-07-16", durationMinutes: 1441 }),
    );
    expect(res.status).toBe(422);
    expect(sleepMocks.upsertManual).not.toHaveBeenCalled();
  });

  it("422s a malformed sleepDate", async () => {
    const { healthSleepPostHandler } =
      await import("../healthSleepPostHandler");
    const res = await healthSleepPostHandler.handle(
      post({ sleepDate: "16-07-2026", durationMinutes: 450 }),
    );
    expect(res.status).toBe(422);
    expect(sleepMocks.upsertManual).not.toHaveBeenCalled();
  });

  it("422s a shape-valid but calendar-impossible sleepDate (no DB call)", async () => {
    const { healthSleepPostHandler } =
      await import("../healthSleepPostHandler");
    const res = await healthSleepPostHandler.handle(
      post({ sleepDate: "2026-13-45", durationMinutes: 450 }),
    );
    expect(res.status).toBe(422);
    expect(sleepMocks.upsertManual).not.toHaveBeenCalled();
  });

  it("accepts the upper bound of 1440", async () => {
    sleepMocks.upsertManual.mockResolvedValue({});
    const { healthSleepPostHandler } =
      await import("../healthSleepPostHandler");
    const res = await healthSleepPostHandler.handle(
      post({ sleepDate: "2026-07-16", durationMinutes: 1440 }),
    );
    expect(res.status).toBe(200);
  });
});

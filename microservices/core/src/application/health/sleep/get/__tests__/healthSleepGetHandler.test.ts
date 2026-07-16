/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sleepMocks = { getForDate: vi.fn() };

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

const req = (auth = true, date = "2026-07-16") =>
  new Request(`http://localhost/health/sleep?date=${date}`, {
    headers: auth ? { authorization: "Bearer token" } : {},
  });

describe("healthSleepGetHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires auth", async () => {
    const { healthSleepGetHandler } = await import("../healthSleepGetHandler");
    expect((await healthSleepGetHandler.handle(req(false))).status).toBe(401);
  });

  it("returns the caller's sleep record for the date", async () => {
    const record = {
      id: "s1",
      userId: "test-user-id",
      sleepDate: "2026-07-16",
      durationMinutes: 450,
    };
    sleepMocks.getForDate.mockResolvedValue(record);
    const { healthSleepGetHandler } = await import("../healthSleepGetHandler");
    const res = await healthSleepGetHandler.handle(req());
    expect(res.status).toBe(200);
    expect(sleepMocks.getForDate).toHaveBeenCalledWith(
      "test-user-id",
      "2026-07-16",
    );
    expect(((await res.json()) as any).sleep).toEqual(record);
  });

  it("returns { sleep: null } when nothing is logged for the date", async () => {
    sleepMocks.getForDate.mockResolvedValue(null);
    const { healthSleepGetHandler } = await import("../healthSleepGetHandler");
    const res = await healthSleepGetHandler.handle(req());
    expect(((await res.json()) as any).sleep).toBeNull();
  });

  it("422s a malformed date query param", async () => {
    const { healthSleepGetHandler } = await import("../healthSleepGetHandler");
    const res = await healthSleepGetHandler.handle(req(true, "16-07-2026"));
    expect(res.status).toBe(422);
    expect(sleepMocks.getForDate).not.toHaveBeenCalled();
  });

  it("422s a shape-valid but calendar-impossible date (no DB call)", async () => {
    const { healthSleepGetHandler } = await import("../healthSleepGetHandler");
    const res = await healthSleepGetHandler.handle(req(true, "2026-02-30"));
    expect(res.status).toBe(422);
    expect(sleepMocks.getForDate).not.toHaveBeenCalled();
  });
});

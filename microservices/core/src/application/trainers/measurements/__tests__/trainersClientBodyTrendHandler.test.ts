/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "trainer-id",
      email: "t@example.com",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "trainer-id" }),
}));

// Guard consolidation (25-coach-client-offboarding): the handler now delegates
// authorization to assertTrainerCanActForClient (role + active non-AI
// relationship + client-not-soft-deleted). Its internals are tested in
// assertTrainerCanActForClient.test.ts; here we mock it and assert the handler
// forwards its verdict.
const assertGuard = vi.fn();
vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: (...args: unknown[]) => assertGuard(...args),
}));

const auditClientDataReadMock = vi.fn(async () => undefined);
vi.mock("../../../relationships/auditClientDataRead", () => ({
  auditClientDataRead: (...a: unknown[]) => auditClientDataReadMock(...(a as [])),
}));

const repo = {
  getUserTimezone: vi.fn(async () => "Europe/London"),
  getBodyTrend: vi.fn(async () => [
    { date: "2026-06-20", weightKg: 80, bodyFat: 21 },
    { date: "2026-06-25", weightKg: 79.2, bodyFat: 20.4 },
  ]),
};
vi.mock("../../../repositories/homeReadRepository", () => ({
  HomeReadRepository: vi.fn(() => repo),
}));

const DENY = {
  allowed: false as const,
  reason: "no_relationship" as const,
  status: 403 as const,
  body: {
    code: "not_your_client",
    message: "You can only act for your active clients",
  },
};

const auth = { authorization: "Bearer token" };

function get(
  clientId: string,
  query = "",
  headers: Record<string, string> = auth,
) {
  return new Request(
    `http://localhost/clients/${clientId}/body-trend${query}`,
    { method: "GET", headers },
  );
}

describe("trainersClientBodyTrendHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertGuard.mockResolvedValue({ allowed: true });
    repo.getUserTimezone.mockResolvedValue("Europe/London");
    repo.getBodyTrend.mockResolvedValue([
      { date: "2026-06-20", weightKg: 80, bodyFat: 21 },
      { date: "2026-06-25", weightKg: 79.2, bodyFat: 20.4 },
    ]);
    auditClientDataReadMock.mockResolvedValue(undefined);
  });

  it("requires auth", async () => {
    const { trainersClientBodyTrendHandler } =
      await import("../trainersClientBodyTrendHandler");
    const res = await trainersClientBodyTrendHandler.handle(
      get("client-1", "", {}),
    );
    expect(res.status).toBe(401);
  });

  it("403 when the guard denies (not the caller's active client) — no data read", async () => {
    assertGuard.mockResolvedValue(DENY);
    const { trainersClientBodyTrendHandler } =
      await import("../trainersClientBodyTrendHandler");
    const res = await trainersClientBodyTrendHandler.handle(get("client-1"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.code).toBe("not_your_client");
    // Guard is called with (trainerId from JWT, clientId from path).
    expect(assertGuard).toHaveBeenCalledWith("trainer-id", "client-1");
    expect(repo.getBodyTrend).not.toHaveBeenCalled();
  });

  it("200 returns the client's trend series bucketed in the CLIENT's timezone", async () => {
    const { trainersClientBodyTrendHandler } =
      await import("../trainersClientBodyTrendHandler");
    const res = await trainersClientBodyTrendHandler.handle(get("client-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([
      { date: "2026-06-20", weightKg: 80, bodyFat: 21 },
      { date: "2026-06-25", weightKg: 79.2, bodyFat: 20.4 },
    ]);
    // Timezone resolved for the CLIENT, not the trainer; default 30d window.
    expect(repo.getUserTimezone).toHaveBeenCalledWith("client-1");
    expect(repo.getBodyTrend).toHaveBeenCalledWith(
      "client-1",
      30,
      "Europe/London",
    );
  });

  it("parses the window query param (capped Nd format)", async () => {
    const { trainersClientBodyTrendHandler } =
      await import("../trainersClientBodyTrendHandler");
    const res = await trainersClientBodyTrendHandler.handle(
      get("client-1", "?window=90d"),
    );
    expect(res.status).toBe(200);
    expect(repo.getBodyTrend).toHaveBeenCalledWith(
      "client-1",
      90,
      "Europe/London",
    );
  });

  it("logs a coach read-audit row (category=body_trend) after the guard passes", async () => {
    const { trainersClientBodyTrendHandler } =
      await import("../trainersClientBodyTrendHandler");
    const res = await trainersClientBodyTrendHandler.handle(get("client-1"));
    expect(res.status).toBe(200);
    expect(auditClientDataReadMock).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      dataCategory: "body_trend",
      route: "/clients/:clientId/body-trend",
    });
  });

  it("still returns 200 with the trend series if the read-audit write throws", async () => {
    auditClientDataReadMock.mockRejectedValue(new Error("audit db down"));
    const { trainersClientBodyTrendHandler } =
      await import("../trainersClientBodyTrendHandler");
    const res = await trainersClientBodyTrendHandler.handle(get("client-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(2);
  });
});

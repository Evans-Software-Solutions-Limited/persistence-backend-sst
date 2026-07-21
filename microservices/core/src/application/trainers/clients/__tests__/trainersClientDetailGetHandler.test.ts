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

const verdict = { value: { allowed: true } as any };
vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: vi.fn(async () => verdict.value),
}));

const getClientDetail = vi.fn();
vi.mock("../../../repositories/clientDetailRepository", () => ({
  ClientDetailRepository: vi.fn(() => ({ getClientDetail })),
}));

const auditClientDataReadMock = vi.fn(async () => undefined);
vi.mock("../../../relationships/auditClientDataRead", () => ({
  auditClientDataRead: (...a: unknown[]) =>
    auditClientDataReadMock(...(a as [])),
}));

import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";

const auth = { authorization: "Bearer token" };

function get(clientId: string, headers: Record<string, string> = auth) {
  return new Request(`http://localhost/trainers/me/clients/${clientId}`, {
    method: "GET",
    headers,
  });
}

const FULL: any = {
  client: {
    id: "client-1",
    name: "Jane Doe",
    initials: "JD",
    avatarUrl: null,
    status: "active",
    ageYears: 30,
    heightCm: 170,
  },
  adherence: { overall: 90, band: "strong", categories: [] },
  prs: [],
  volume: { weekKg: 1500, daily: [] },
  calorieHit: null,
  goal: null,
  habits: null,
  aiSummary: {
    summary: null,
    coversDate: null,
    generatedAt: null,
    canManualRefresh: false,
  },
  thisWeek: {
    workoutsCompleted: 2,
    workoutsPlanned: 3,
    volumeKg: 1500,
    prs: 0,
    checkIns: null,
  },
  recentSessions: [],
  notes: [],
};

describe("trainersClientDetailGetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verdict.value = { allowed: true };
    getClientDetail.mockResolvedValue(FULL);
    auditClientDataReadMock.mockResolvedValue(undefined);
  });

  it("requires auth (401 without a bearer token)", async () => {
    const { trainersClientDetailGetHandler } =
      await import("../trainersClientDetailGetHandler");
    const res = await trainersClientDetailGetHandler.handle(
      get("client-1", {}),
    );
    expect(res.status).toBe(401);
    expect(getClientDetail).not.toHaveBeenCalled();
  });

  it("403 wrong_role when the caller is not a trainer (gate verdict mapped)", async () => {
    verdict.value = {
      allowed: false,
      reason: "wrong_role",
      status: 403,
      body: { code: "not_a_trainer", message: "…" },
    };
    const { trainersClientDetailGetHandler } =
      await import("../trainersClientDetailGetHandler");
    const res = await trainersClientDetailGetHandler.handle(get("client-1"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_a_trainer");
    expect(getClientDetail).not.toHaveBeenCalled();
  });

  it("403 no_relationship when there is no active relationship", async () => {
    verdict.value = {
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client", message: "…" },
    };
    const { trainersClientDetailGetHandler } =
      await import("../trainersClientDetailGetHandler");
    const res = await trainersClientDetailGetHandler.handle(get("client-1"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("not_your_client");
    expect(getClientDetail).not.toHaveBeenCalled();
  });

  it("200 returns { data: ClientDetail } for an active client; gate is called with (trainer, client)", async () => {
    const { trainersClientDetailGetHandler } =
      await import("../trainersClientDetailGetHandler");
    const res = await trainersClientDetailGetHandler.handle(get("client-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.client.id).toBe("client-1");
    expect(body.data.adherence.band).toBe("strong");
    // aiSummary stub shape passes straight through (module g not built).
    expect(body.data.aiSummary).toEqual({
      summary: null,
      coversDate: null,
      generatedAt: null,
      canManualRefresh: false,
    });
    expect(assertTrainerCanActForClient).toHaveBeenCalledWith(
      "trainer-id",
      "client-1",
    );
    expect(getClientDetail).toHaveBeenCalledWith("trainer-id", "client-1");
  });

  it("logs a coach read-audit row (category=client_detail_aggregate) after the gate passes", async () => {
    const { trainersClientDetailGetHandler } =
      await import("../trainersClientDetailGetHandler");
    const res = await trainersClientDetailGetHandler.handle(get("client-1"));
    expect(res.status).toBe(200);
    expect(auditClientDataReadMock).toHaveBeenCalledWith({
      trainerId: "trainer-id",
      clientId: "client-1",
      dataCategory: "client_detail_aggregate",
      route: "/trainers/me/clients/:clientId",
    });
  });

  it("still returns 200 with the client detail aggregate if the read-audit write throws", async () => {
    auditClientDataReadMock.mockRejectedValue(new Error("audit db down"));
    const { trainersClientDetailGetHandler } =
      await import("../trainersClientDetailGetHandler");
    const res = await trainersClientDetailGetHandler.handle(get("client-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.client.id).toBe("client-1");
  });
});

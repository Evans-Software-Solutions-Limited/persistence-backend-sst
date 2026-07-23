/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const programMocks = {
  getForAthlete: vi.fn(),
};

// Harmless getDb stub — the handler goes through the mocked repository, never
// touches the DB directly.
vi.mock("@persistence/db/client", () => ({
  getDb: () => {
    const chain: any = {};
    for (const k of ["from", "innerJoin", "where", "limit", "orderBy"])
      chain[k] = () => chain;
    chain.then = (res: any, rej: any) => Promise.resolve([]).then(res, rej);
    return { select: () => chain };
  },
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "athlete-id",
      email: "a@example.com",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "athlete-id" }),
}));

vi.mock("../../repositories/programRepository", () => ({
  ProgramRepository: vi.fn().mockImplementation(() => programMocks),
  LIVE_ASSIGNMENT_STATUSES: ["assigned", "started"],
}));
vi.mock("../../repositories/programAssignmentRepository", () => ({
  ProgramAssignmentRepository: vi.fn().mockImplementation(() => ({})),
}));

const authed = (url: string) =>
  new Request(`http://localhost${url}`, {
    method: "GET",
    headers: { authorization: "Bearer token" },
  });

describe("GET /programs/:id (athlete-facing)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without a bearer token", async () => {
    const { programGetHandler } = await import("../programGetHandler");
    const res = await programGetHandler.handle(
      new Request("http://localhost/programs/p-1", { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });

  it("404 when the caller has no assignment to the programme (no existence leak)", async () => {
    programMocks.getForAthlete.mockResolvedValue(null);
    const { programGetHandler } = await import("../programGetHandler");
    const res = await programGetHandler.handle(authed("/programs/p-x"));
    expect(res.status).toBe(404);
    expect(programMocks.getForAthlete).toHaveBeenCalledWith(
      "athlete-id",
      "p-x",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("returns the athlete programme detail scoped to the caller", async () => {
    programMocks.getForAthlete.mockResolvedValue({
      id: "p-1",
      name: "Hypertrophy Block",
      week: 2,
      durationWeeks: 8,
      workouts: [{ id: "pw-1", workoutId: "w-1", position: 0, name: "Push" }],
    });
    const { programGetHandler } = await import("../programGetHandler");
    const res = await programGetHandler.handle(authed("/programs/p-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe("p-1");
    expect(programMocks.getForAthlete).toHaveBeenCalledWith(
      "athlete-id",
      "p-1",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });
});

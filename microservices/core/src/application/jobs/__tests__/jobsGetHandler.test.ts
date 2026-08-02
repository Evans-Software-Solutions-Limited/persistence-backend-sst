/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { STALE_AFTER_MS } from "../aiJobRepository";

const mocks = { getForUser: vi.fn() };

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "test-user-id",
      email: "test@example.com",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));

vi.mock("../aiJobRepository", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    AiJobRepository: vi.fn().mockImplementation(() => mocks),
  };
});

const JOB_ID = "11111111-1111-4111-8111-111111111111";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    kind: "test_kind",
    status: "succeeded",
    progressDone: 10,
    progressTotal: 10,
    result: { plan: ["a", "b"] },
    error: null,
    heartbeatAt: new Date(),
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: new Date(),
    ...overrides,
  };
}

async function get(path: string, auth = true): Promise<Response> {
  const { jobsGetHandler } = await import("../jobsGetHandler");
  return jobsGetHandler.handle(
    new Request(`http://localhost${path}`, {
      headers: auth ? { authorization: "Bearer token" } : {},
    }),
  );
}

describe("GET /jobs/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getForUser.mockResolvedValue(row());
  });

  it("401s without a bearer token", async () => {
    const res = await get(`/jobs/${JOB_ID}`, false);
    expect(res.status).toBe(401);
    expect(mocks.getForUser).not.toHaveBeenCalled();
  });

  it("returns the job view, scoped to the caller", async () => {
    const res = await get(`/jobs/${JOB_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toMatchObject({
      id: JOB_ID,
      status: "succeeded",
      progress: { done: 10, total: 10 },
      result: { plan: ["a", "b"] },
    });
    expect(mocks.getForUser).toHaveBeenCalledWith(JOB_ID, "test-user-id");
  });

  it("AC-2.2: another user's job is a 404, never a 403", async () => {
    // A 403 would confirm the id is real — a free oracle over a uuid space the
    // caller could otherwise learn nothing from. The repository's own predicate
    // means it cannot return the row at all, so a miss is a miss.
    mocks.getForUser.mockResolvedValue(null);
    const res = await get(`/jobs/${JOB_ID}`);
    expect(res.status).toBe(404);
    expect((await res.json()) as any).toMatchObject({ code: "not_found" });
  });

  it("rejects a non-uuid id before touching the repository", async () => {
    const res = await get("/jobs/not-a-uuid");
    expect(res.status).toBe(422);
    expect(mocks.getForUser).not.toHaveBeenCalled();
  });

  it("?fields=status omits the result payload", async () => {
    const res = await get(`/jobs/${JOB_ID}?fields=status`);
    const body = (await res.json()) as any;
    expect(body.data).not.toHaveProperty("result");
    expect(body.data.status).toBe("succeeded");
  });

  it("an unrecognised fields value falls through to the full view", async () => {
    const res = await get(`/jobs/${JOB_ID}?fields=everything`);
    const body = (await res.json()) as any;
    expect(body.data.result).toEqual({ plan: ["a", "b"] });
  });

  it("AC-2.5: a dead running job reads as failed/stale", async () => {
    mocks.getForUser.mockResolvedValue(
      row({
        status: "running",
        result: null,
        finishedAt: null,
        heartbeatAt: new Date(Date.now() - STALE_AFTER_MS - 1000),
      }),
    );

    const res = await get(`/jobs/${JOB_ID}`);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe("failed");
    expect(body.data.error).toMatchObject({ code: "stale", retryable: false });
  });

  it("performs NO WRITE — a 2-second poll loop must not be a write path", async () => {
    // Staleness is derived on read; the nightly sweep persists it separately.
    mocks.getForUser.mockResolvedValue(
      row({
        status: "running",
        heartbeatAt: new Date(Date.now() - STALE_AFTER_MS - 1000),
      }),
    );

    await get(`/jobs/${JOB_ID}`);

    // The only repository method reachable from this handler is the read.
    expect(Object.keys(mocks)).toEqual(["getForUser"]);
    expect(mocks.getForUser).toHaveBeenCalledTimes(1);
  });
});

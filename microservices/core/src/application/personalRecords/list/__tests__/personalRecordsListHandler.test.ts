/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { list: vi.fn() };

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

vi.mock("../../../repositories/personalRecordsRepository", () => ({
  PersonalRecordsRepository: vi.fn().mockImplementation(() => mocks),
}));

describe("personalRecordsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([
      {
        id: "pr-1",
        userId: "test-user-id",
        exerciseId: "exercise-1",
        recordType: "1rm",
        value: "120.50",
        setId: "set-1",
        achievedAt: new Date(),
      },
    ]);
  });

  it("requires authentication", async () => {
    const { personalRecordsListHandler } =
      await import("../personalRecordsListHandler");
    const response = await personalRecordsListHandler.handle(
      new Request("http://localhost/personal-records", { method: "GET" }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 200 with the user's PR list", async () => {
    const { personalRecordsListHandler } =
      await import("../personalRecordsListHandler");
    const response = await personalRecordsListHandler.handle(
      new Request("http://localhost/personal-records", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      exerciseId: undefined,
      recordType: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it("forwards exerciseId filter to the repository", async () => {
    const { personalRecordsListHandler } =
      await import("../personalRecordsListHandler");
    await personalRecordsListHandler.handle(
      new Request("http://localhost/personal-records?exerciseId=exercise-42", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      exerciseId: "exercise-42",
      recordType: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it("forwards recordType filter and accepts the 1rm enum value", async () => {
    const { personalRecordsListHandler } =
      await import("../personalRecordsListHandler");
    const response = await personalRecordsListHandler.handle(
      new Request("http://localhost/personal-records?recordType=1rm", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      exerciseId: undefined,
      recordType: "1rm",
      limit: undefined,
      offset: undefined,
    });
  });

  it("rejects unknown recordType values via the query schema", async () => {
    const { personalRecordsListHandler } =
      await import("../personalRecordsListHandler");
    const response = await personalRecordsListHandler.handle(
      new Request("http://localhost/personal-records?recordType=banana", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("forwards limit and offset query params", async () => {
    const { personalRecordsListHandler } =
      await import("../personalRecordsListHandler");
    await personalRecordsListHandler.handle(
      new Request("http://localhost/personal-records?limit=10&offset=5", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      exerciseId: undefined,
      recordType: undefined,
      limit: 10,
      offset: 5,
    });
  });
});

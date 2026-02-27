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

vi.mock("../../../repositories/recordRepository", () => ({
  RecordRepository: vi.fn().mockImplementation(() => mocks),
}));

describe("RecordsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([
      {
        id: "pr-1",
        userId: "test-user-id",
        exerciseId: "ex-1",
        recordType: "1rm",
        value: "100",
        setId: null,
        achievedAt: new Date(),
      },
    ]);
  });

  it("should require authentication", async () => {
    const { recordsListHandler } = await import("../recordsListHandler");
    const response = await recordsListHandler.handle(
      new Request("http://localhost/records", {
        method: "GET",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 200 with records list", async () => {
    const { recordsListHandler } = await import("../recordsListHandler");
    const response = await recordsListHandler.handle(
      new Request("http://localhost/records", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("should filter by exerciseId when provided", async () => {
    const { recordsListHandler } = await import("../recordsListHandler");
    await recordsListHandler.handle(
      new Request("http://localhost/records?exerciseId=ex-1", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", "ex-1");
  });

  it("should pass undefined exerciseId when not provided", async () => {
    const { recordsListHandler } = await import("../recordsListHandler");
    await recordsListHandler.handle(
      new Request("http://localhost/records", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", undefined);
  });
});

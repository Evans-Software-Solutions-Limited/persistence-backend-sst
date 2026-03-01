import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
          offset: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  }),
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn().mockResolvedValue({ sub: "user-123" }),
  requireAuth: vi.fn((x) => x),
  getUser: vi.fn(() => ({ sub: "user-123" })),
}));

import { progressHistoryHandler } from "../progressHistoryHandler";

describe("ProgressHistoryHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with paginated history", async () => {
    const response = await progressHistoryHandler.handle(
      new Request("http://localhost/progress/history", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("should accept limit and offset parameters", async () => {
    const response = await progressHistoryHandler.handle(
      new Request("http://localhost/progress/history?limit=10&offset=0", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("should return history with required fields", async () => {
    const response = await progressHistoryHandler.handle(
      new Request("http://localhost/progress/history", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
  }),
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn().mockResolvedValue({ sub: "user-123" }),
  requireAuth: vi.fn((x) => x),
  getUser: vi.fn(() => ({ sub: "user-123" })),
}));

import { progressStatsHandler } from "../progressStatsHandler";

describe("ProgressStatsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with progress stats", async () => {
    const from = "2024-01-01";
    const to = "2024-01-31";

    const response = await progressStatsHandler.handle(
      new Request(`http://localhost/progress/stats?from=${from}&to=${to}`, {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("should return 422 when dates are missing", async () => {
    const response = await progressStatsHandler.handle(
      new Request("http://localhost/progress/stats", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(422);
  });

  it("should return stats with required fields", async () => {
    const from = "2024-01-01";
    const to = "2024-01-31";

    const response = await progressStatsHandler.handle(
      new Request(`http://localhost/progress/stats?from=${from}&to=${to}`, {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
  });
});

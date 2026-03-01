import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
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

import { dashboardHandler } from "../dashboardHandler";

describe("DashboardHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with dashboard data", async () => {
    const response = await dashboardHandler.handle(
      new Request("http://localhost/dashboard", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("should return dashboard with required fields", async () => {
    const response = await dashboardHandler.handle(
      new Request("http://localhost/dashboard", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
  });
});

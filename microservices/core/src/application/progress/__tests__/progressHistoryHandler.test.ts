import { describe, it, expect, vi, beforeEach } from "vitest";
import { progressHistoryHandler } from "../progressHistoryHandler";

vi.mock("../../../repositories/progressRepository", () => ({
  ProgressRepository: vi.fn().mockImplementation(() => ({
    getHistory: vi.fn().mockResolvedValue([
      {
        id: "session-1",
        name: "Workout 1",
        startedAt: "2024-01-15T10:00:00Z",
        completedAt: "2024-01-15T11:00:00Z",
        status: "completed",
        totalDurationSeconds: 3600,
      },
    ]),
  })),
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn().mockResolvedValue({ sub: "user-123" }),
  requireAuth: vi.fn((x) => x),
  getUser: vi.fn(() => ({ sub: "user-123" })),
}));

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
    const body = (await response.json()) as { data: unknown[] };
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
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

    const body = (await response.json()) as {
      data: { id: string; name: string; startedAt: string; status: string }[];
    };

    if (body.data.length > 0) {
      expect(body.data[0]).toHaveProperty("id");
      expect(body.data[0]).toHaveProperty("startedAt");
      expect(body.data[0]).toHaveProperty("status");
    }
  });
});

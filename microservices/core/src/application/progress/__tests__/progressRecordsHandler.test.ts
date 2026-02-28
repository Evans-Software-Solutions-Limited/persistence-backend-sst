import { describe, it, expect, vi, beforeEach } from "vitest";
import { progressRecordsHandler } from "../progressRecordsHandler";

vi.mock("../../../repositories/progressRepository", () => ({
  ProgressRepository: vi.fn().mockImplementation(() => ({
    getRecords: vi.fn().mockResolvedValue([
      {
        id: "record-1",
        exerciseId: "exercise-1",
        recordType: "1rm",
        value: 100,
        achievedAt: "2024-01-15T10:00:00Z",
      },
    ]),
  })),
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn().mockResolvedValue({ sub: "user-123" }),
  requireAuth: vi.fn((x) => x),
  getUser: vi.fn(() => ({ sub: "user-123" })),
}));

describe("ProgressRecordsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with personal records", async () => {
    const response = await progressRecordsHandler.handle(
      new Request("http://localhost/progress/records", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("should return records with required fields", async () => {
    const response = await progressRecordsHandler.handle(
      new Request("http://localhost/progress/records", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    const body = (await response.json()) as {
      data: {
        id: string;
        exerciseId: string;
        recordType: string;
        value: number;
      }[];
    };

    if (body.data.length > 0) {
      expect(body.data[0]).toHaveProperty("id");
      expect(body.data[0]).toHaveProperty("exerciseId");
      expect(body.data[0]).toHaveProperty("recordType");
      expect(body.data[0]).toHaveProperty("value");
    }
  });
});

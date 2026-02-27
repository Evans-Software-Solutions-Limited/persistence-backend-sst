/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { create: vi.fn() };

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

vi.mock("../../../repositories/sessionRepository", () => ({
  SessionRepository: vi.fn().mockImplementation(() => mocks),
}));

describe("SessionsCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({
      id: "session-1",
      userId: "test-user-id",
      workoutId: "w1",
      name: "Test Session",
      status: "in_progress",
      startedAt: new Date(),
      completedAt: null,
      totalDurationSeconds: null,
      userNotes: null,
      trainerFeedback: null,
      sessionRating: null,
      overallRpe: null,
      difficultyRanking: null,
      createdAt: new Date(),
    });
  });

  it("should require authentication", async () => {
    const { sessionsCreateHandler } = await import("../sessionsCreateHandler");
    const response = await sessionsCreateHandler.handle(
      new Request("http://localhost/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 201 on successful creation", async () => {
    const { sessionsCreateHandler } = await import("../sessionsCreateHandler");
    const response = await sessionsCreateHandler.handle(
      new Request("http://localhost/sessions", {
        method: "POST",
        body: JSON.stringify({ name: "Test Session" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(201);
    const data = (await response.json()) as any;
    expect(data).toHaveProperty("data");
    expect(data.data.id).toBe("session-1");
  });

  it("should accept optional workoutId", async () => {
    const { sessionsCreateHandler } = await import("../sessionsCreateHandler");
    const response = await sessionsCreateHandler.handle(
      new Request("http://localhost/sessions", {
        method: "POST",
        body: JSON.stringify({ workoutId: "w1", name: "Test Session" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(201);
  });

  it("should set default status to in_progress", async () => {
    const { sessionsCreateHandler } = await import("../sessionsCreateHandler");
    await sessionsCreateHandler.handle(
      new Request("http://localhost/sessions", {
        method: "POST",
        body: JSON.stringify({}),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(mocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({
        status: "in_progress",
      }),
    );
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionMocks = { update: vi.fn(), getById: vi.fn() };
const prMocks = { recordPRsForSession: vi.fn() };

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
  SessionRepository: vi.fn().mockImplementation(() => sessionMocks),
}));

vi.mock("../../../repositories/personalRecordsRepository", () => ({
  PersonalRecordsRepository: vi.fn().mockImplementation(() => prMocks),
}));

describe("SessionsUpdateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.update.mockResolvedValue({
      id: "session-1",
      userId: "test-user-id",
      workoutId: "w1",
      name: "Updated Session",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
    });
    sessionMocks.getById.mockResolvedValue({
      id: "session-1",
      userId: "test-user-id",
      status: "in_progress",
      exercises: [],
    });
    prMocks.recordPRsForSession.mockResolvedValue(undefined);
  });

  it("should require authentication", async () => {
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    const response = await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 200 on successful update", async () => {
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    const response = await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("should return 404 when session not found", async () => {
    sessionMocks.update.mockResolvedValue(null);
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    const response = await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("triggers server-side PR detection on in_progress → completed", async () => {
    sessionMocks.getById.mockResolvedValue({
      id: "session-1",
      userId: "test-user-id",
      status: "in_progress",
      exercises: [],
    });
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(prMocks.recordPRsForSession).toHaveBeenCalledWith(
      "test-user-id",
      "s1",
    );
  });

  it("does NOT re-run PR detection on completed → completed (idempotency)", async () => {
    sessionMocks.getById.mockResolvedValue({
      id: "session-1",
      userId: "test-user-id",
      status: "completed",
      exercises: [],
    });
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(prMocks.recordPRsForSession).not.toHaveBeenCalled();
  });

  it("does NOT run PR detection on a non-status PATCH", async () => {
    sessionMocks.update.mockResolvedValue({
      id: "session-1",
      userId: "test-user-id",
      status: "in_progress",
      startedAt: new Date(),
      createdAt: new Date(),
    });
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "PATCH",
        body: JSON.stringify({ userNotes: "felt strong today" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(prMocks.recordPRsForSession).not.toHaveBeenCalled();
  });

  it("returns 200 even when PR detection throws (logs + carries on)", async () => {
    prMocks.recordPRsForSession.mockRejectedValue(
      new Error("transient db error"),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    const response = await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should return 400 when no valid fields provided", async () => {
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    const response = await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(400);
  });
});

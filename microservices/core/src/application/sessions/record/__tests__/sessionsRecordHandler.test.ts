/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionMocks = { recordSession: vi.fn() };
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

const validBody = {
  workoutId: "workout-1",
  name: "Push Day",
  startedAt: "2026-05-04T10:00:00.000Z",
  completedAt: "2026-05-04T11:00:00.000Z",
  status: "completed",
  totalDurationSeconds: 3600,
  userNotes: "felt strong",
  exercises: [
    {
      exerciseId: "ex-1",
      sortOrder: 1,
      supersetGroup: null,
      isSubstituted: false,
      sets: [
        {
          setNumber: 1,
          reps: 5,
          weightKg: 100,
          isCompleted: true,
          completedAt: "2026-05-04T10:05:00.000Z",
        },
      ],
    },
  ],
};

describe("sessionsRecordHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.recordSession.mockResolvedValue({
      id: "server-session-1",
      userId: "test-user-id",
      workoutId: "workout-1",
      name: "Push Day",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      exercises: [
        {
          id: "server-ex-1",
          sessionId: "server-session-1",
          exerciseId: "ex-1",
          sortOrder: 1,
          supersetGroup: null,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [
            {
              id: "server-set-1",
              sessionExerciseId: "server-ex-1",
              setNumber: 1,
              reps: 5,
              weightKg: "100.00",
              isCompleted: true,
              isPersonalRecord: false,
              completedAt: new Date(),
            },
          ],
        },
      ],
    });
    prMocks.recordPRsForSession.mockResolvedValue(undefined);
  });

  it("requires authentication", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    const response = await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 201 with the recorded session on success", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    const response = await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validBody),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { id: string } };
    expect(body.data.id).toBe("server-session-1");
  });

  it("forwards the userId from JWT (never the body) to recordSession", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...validBody,
          // Attempt to spoof userId in the body — handler must ignore
          // the body field entirely and use the JWT-derived sub.
          userId: "ATTACKER-SPOOFED-USER",
        }),
      }),
    );
    expect(sessionMocks.recordSession).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ name: "Push Day" }),
      expect.any(Function),
    );
  });

  it("rejects payloads with empty exercises array (minItems: 1)", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    const response = await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...validBody, exercises: [] }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("rejects payloads with an unknown status value via the body schema", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    const response = await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...validBody, status: "in_progress" }),
      }),
    );
    // Bulk-record only accepts terminal statuses (completed | cancelled);
    // a session that's still in-progress shouldn't be flushed yet.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("threads the PR-detection function so the repo runs it inside its tx", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validBody),
      }),
    );
    // The third arg to recordSession is the injected PR-detection
    // callback. Calling it should invoke prMocks.recordPRsForSession.
    const passedCallback = sessionMocks.recordSession.mock.calls[0]?.[2];
    expect(typeof passedCallback).toBe("function");
    const fakeTx = { fake: "tx" };
    await passedCallback("test-user-id", "server-session-1", fakeTx);
    expect(prMocks.recordPRsForSession).toHaveBeenCalledWith(
      "test-user-id",
      "server-session-1",
      fakeTx,
    );
  });

  it("accepts a status: cancelled payload (discard flow)", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    const response = await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...validBody,
          status: "cancelled",
          completedAt: null,
        }),
      }),
    );
    expect(response.status).toBe(201);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { setNotificationPreferences: vi.fn() };

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

// Mock only the class; keep helpers real.
vi.mock(
  "../../../../repositories/profileRepository",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../repositories/profileRepository")
      >();
    return {
      ...actual,
      ProfileRepository: vi.fn().mockImplementation(() => mocks),
    };
  },
);

describe("PreferencesSetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setNotificationPreferences.mockResolvedValue(true);
  });

  const FULL_BODY = {
    workout_assigned: true,
    friend_request: true,
    pt_request: true,
    pt_accepted: true,
    physio_request: true,
    physio_accepted: true,
    workout_reminder: false,
    goal_milestone: true,
    trainer_feedback: true,
  };

  it("requires authentication", async () => {
    const { preferencesSetHandler } = await import("../preferencesSetHandler");
    const response = await preferencesSetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(FULL_BODY),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 200 echoing the merged map on success", async () => {
    const { preferencesSetHandler } = await import("../preferencesSetHandler");
    const response = await preferencesSetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(FULL_BODY),
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.data.workout_reminder).toBe(false);
    expect(data.data.trainer_feedback).toBe(true);
  });

  it("rejects unknown keys with 400", async () => {
    const { preferencesSetHandler } = await import("../preferencesSetHandler");
    const response = await preferencesSetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workout_reminder: false,
          legacy_unknown_key: true,
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.setNotificationPreferences).not.toHaveBeenCalled();
  });

  it("rejects non-boolean values with 400", async () => {
    const { preferencesSetHandler } = await import("../preferencesSetHandler");
    const response = await preferencesSetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workout_reminder: "yes",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.setNotificationPreferences).not.toHaveBeenCalled();
  });

  it("rejects array bodies with 400", async () => {
    const { preferencesSetHandler } = await import("../preferencesSetHandler");
    const response = await preferencesSetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(["workout_reminder"]),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.setNotificationPreferences).not.toHaveBeenCalled();
  });

  it("accepts empty body {} and writes the empty map (reads back as defaults)", async () => {
    const { preferencesSetHandler } = await import("../preferencesSetHandler");
    const response = await preferencesSetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.setNotificationPreferences).toHaveBeenCalledWith(
      "test-user-id",
      {},
    );
  });

  it("accepts a partial map (subset of NotificationType keys)", async () => {
    const { preferencesSetHandler } = await import("../preferencesSetHandler");
    const response = await preferencesSetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workout_reminder: false }),
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.data.workout_reminder).toBe(false);
    // Missing keys are filled with defaults in the echoed payload
    expect(data.data.trainer_feedback).toBe(true);
    expect(mocks.setNotificationPreferences).toHaveBeenCalledWith(
      "test-user-id",
      { workout_reminder: false },
    );
  });

  it("returns 404 when the profile row is missing", async () => {
    mocks.setNotificationPreferences.mockResolvedValueOnce(false);
    const { preferencesSetHandler } = await import("../preferencesSetHandler");
    const response = await preferencesSetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("forwards JWT userId (ignores any body-supplied user identity)", async () => {
    const { preferencesSetHandler } = await import("../preferencesSetHandler");
    await preferencesSetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workout_reminder: false }),
      }),
    );
    expect(mocks.setNotificationPreferences).toHaveBeenCalledWith(
      "test-user-id",
      { workout_reminder: false },
    );
  });
});

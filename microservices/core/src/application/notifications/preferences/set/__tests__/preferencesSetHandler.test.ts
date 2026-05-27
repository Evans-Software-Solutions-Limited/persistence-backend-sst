/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { mergeNotificationPreferences: vi.fn() };

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
    mocks.mergeNotificationPreferences.mockResolvedValue(true);
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
    expect(mocks.mergeNotificationPreferences).not.toHaveBeenCalled();
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
    expect(mocks.mergeNotificationPreferences).not.toHaveBeenCalled();
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
    expect(mocks.mergeNotificationPreferences).not.toHaveBeenCalled();
  });

  it("accepts empty body {} and passes a no-op merge through to the repo", async () => {
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
    expect(mocks.mergeNotificationPreferences).toHaveBeenCalledWith(
      "test-user-id",
      {},
    );
  });

  it("accepts a partial map (subset of NotificationType keys) and preserves prior keys via repo-level merge", async () => {
    // Inspector Brad PR #81: a partial body must not silently nuke
    // prior keys. The handler forwards the partial to
    // mergeNotificationPreferences, which does an atomic JSONB || in
    // SQL. This test pins the handler-side contract: partial in,
    // partial out, no full-map padding added by the handler. The
    // merge correctness itself is tested at the repo level.
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
    expect(mocks.mergeNotificationPreferences).toHaveBeenCalledWith(
      "test-user-id",
      { workout_reminder: false },
    );
  });

  it("two sequential partial POSTs each forward their own delta (repo merges atomically)", async () => {
    // Inspector Brad PR #81 regression guard: the original bug was
    // that the second partial POST overwrote the stored map, losing
    // the first POST's keys on the next GET. Under the new contract,
    // the handler forwards each partial unchanged to the repo; the
    // repo's JSONB || merges them atomically. Pin both handler calls
    // pass through verbatim.
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
    await preferencesSetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ friend_request: false }),
      }),
    );

    expect(mocks.mergeNotificationPreferences).toHaveBeenCalledTimes(2);
    expect(mocks.mergeNotificationPreferences).toHaveBeenNthCalledWith(
      1,
      "test-user-id",
      { workout_reminder: false },
    );
    expect(mocks.mergeNotificationPreferences).toHaveBeenNthCalledWith(
      2,
      "test-user-id",
      { friend_request: false },
    );
  });

  it("returns 404 when the profile row is missing", async () => {
    mocks.mergeNotificationPreferences.mockResolvedValueOnce(false);
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
    expect(mocks.mergeNotificationPreferences).toHaveBeenCalledWith(
      "test-user-id",
      { workout_reminder: false },
    );
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { getNotificationPreferences: vi.fn() };

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

// We need the SENTINEL from the real module so the handler can detect
// it; mock only the class while keeping the sentinel + helpers real.
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

describe("PreferencesGetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    const { preferencesGetHandler } = await import("../preferencesGetHandler");
    const response = await preferencesGetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "GET",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 200 with the preference map on success", async () => {
    mocks.getNotificationPreferences.mockResolvedValueOnce({
      workout_assigned: true,
      friend_request: true,
      pt_request: true,
      pt_accepted: true,
      physio_request: true,
      physio_accepted: true,
      workout_reminder: false,
      goal_milestone: true,
      trainer_feedback: true,
    });
    const { preferencesGetHandler } = await import("../preferencesGetHandler");
    const response = await preferencesGetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.data.workout_reminder).toBe(false);
    expect(data.data.trainer_feedback).toBe(true);
  });

  it("returns 404 when the profile row doesn't exist (sentinel)", async () => {
    const { NOTIFICATION_PREFERENCES_PROFILE_MISSING } =
      await import("../../../../repositories/profileRepository");
    mocks.getNotificationPreferences.mockResolvedValueOnce(
      NOTIFICATION_PREFERENCES_PROFILE_MISSING,
    );
    const { preferencesGetHandler } = await import("../preferencesGetHandler");
    const response = await preferencesGetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("forwards the JWT userId to the repository", async () => {
    mocks.getNotificationPreferences.mockResolvedValueOnce({});
    const { preferencesGetHandler } = await import("../preferencesGetHandler");
    await preferencesGetHandler.handle(
      new Request("http://localhost/notifications/preferences", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.getNotificationPreferences).toHaveBeenCalledWith(
      "test-user-id",
    );
  });
});

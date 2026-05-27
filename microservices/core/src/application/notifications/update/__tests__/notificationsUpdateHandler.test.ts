/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { markRead: vi.fn() };

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

vi.mock("../../../repositories/notificationRepository", () => ({
  NotificationRepository: vi.fn().mockImplementation(() => mocks),
}));

const READ_NOTIFICATION = {
  id: "n1",
  userId: "test-user-id",
  type: "workout_assigned",
  title: "Push Day",
  message: "Your trainer assigned a workout",
  data: { deepLink: "/(app)/(tabs)/workouts" },
  isRead: true,
  readAt: "2026-05-27T11:00:00.000Z",
  relatedEntityType: null,
  relatedEntityId: null,
  createdAt: "2026-05-27T10:00:00.000Z",
};

describe("NotificationsUpdateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markRead.mockResolvedValue(READ_NOTIFICATION);
  });

  it("requires authentication", async () => {
    const { notificationsUpdateHandler } =
      await import("../notificationsUpdateHandler");
    const response = await notificationsUpdateHandler.handle(
      new Request("http://localhost/notifications/n1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 200 with the updated row on success", async () => {
    const { notificationsUpdateHandler } =
      await import("../notificationsUpdateHandler");
    const response = await notificationsUpdateHandler.handle(
      new Request("http://localhost/notifications/n1", {
        method: "PATCH",
        body: JSON.stringify({ isRead: true }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.data.id).toBe("n1");
    expect(data.data.isRead).toBe(true);
  });

  it("returns 404 when the notification doesn't exist or is owned by another user", async () => {
    mocks.markRead.mockResolvedValueOnce(null);
    const { notificationsUpdateHandler } =
      await import("../notificationsUpdateHandler");
    const response = await notificationsUpdateHandler.handle(
      new Request("http://localhost/notifications/n1", {
        method: "PATCH",
        body: JSON.stringify({ isRead: true }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("forwards JWT userId + path id (never trusts body)", async () => {
    const { notificationsUpdateHandler } =
      await import("../notificationsUpdateHandler");
    await notificationsUpdateHandler.handle(
      new Request("http://localhost/notifications/n1", {
        method: "PATCH",
        body: JSON.stringify({
          // Attempting to spoof userId in body — must be ignored
          userId: "attacker-id",
          isRead: true,
        }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(mocks.markRead).toHaveBeenCalledWith("test-user-id", "n1");
  });

  it("rejects body that doesn't have isRead: true (validation)", async () => {
    const { notificationsUpdateHandler } =
      await import("../notificationsUpdateHandler");
    const response = await notificationsUpdateHandler.handle(
      new Request("http://localhost/notifications/n1", {
        method: "PATCH",
        body: JSON.stringify({ isRead: false }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("is idempotent — re-marking an already-read row returns 200 with the row", async () => {
    // Repository returns the same row whether the WHERE matched a
    // newly-read or already-read row. Handler should pass through.
    mocks.markRead.mockResolvedValueOnce(READ_NOTIFICATION);
    const { notificationsUpdateHandler } =
      await import("../notificationsUpdateHandler");
    const response = await notificationsUpdateHandler.handle(
      new Request("http://localhost/notifications/n1", {
        method: "PATCH",
        body: JSON.stringify({ isRead: true }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(200);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { list: vi.fn(), countUnread: vi.fn() };

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

describe("NotificationsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([
      {
        id: "n1",
        userId: "test-user-id",
        type: "workout_assigned",
        title: "Push Day",
        message: null,
        data: {},
        isRead: false,
        readAt: null,
        relatedEntityType: null,
        relatedEntityId: null,
        createdAt: "2026-05-27T10:00:00.000Z",
      },
    ]);
    mocks.countUnread.mockResolvedValue(1);
  });

  it("requires authentication", async () => {
    const { notificationsListHandler } =
      await import("../notificationsListHandler");
    const response = await notificationsListHandler.handle(
      new Request("http://localhost/notifications", { method: "GET" }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 200 with { data, unreadCount }", async () => {
    const { notificationsListHandler } =
      await import("../notificationsListHandler");
    const response = await notificationsListHandler.handle(
      new Request("http://localhost/notifications", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.unreadCount).toBe(1);
  });

  it("uses defaults (limit=50, offset=0, unreadOnly=false)", async () => {
    const { notificationsListHandler } =
      await import("../notificationsListHandler");
    await notificationsListHandler.handle(
      new Request("http://localhost/notifications", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      limit: 50,
      offset: 0,
      unreadOnly: false,
    });
  });

  it("clamps limit to the max of 100, not 400 (tolerant pagination)", async () => {
    const { notificationsListHandler } =
      await import("../notificationsListHandler");
    const response = await notificationsListHandler.handle(
      new Request("http://localhost/notifications?limit=500", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      limit: 100,
      offset: 0,
      unreadOnly: false,
    });
  });

  it("forwards unreadOnly=true through to the repository", async () => {
    const { notificationsListHandler } =
      await import("../notificationsListHandler");
    await notificationsListHandler.handle(
      new Request("http://localhost/notifications?unreadOnly=true", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      limit: 50,
      offset: 0,
      unreadOnly: true,
    });
  });

  it("supports pagination via offset", async () => {
    const { notificationsListHandler } =
      await import("../notificationsListHandler");
    await notificationsListHandler.handle(
      new Request("http://localhost/notifications?limit=10&offset=20", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      limit: 10,
      offset: 20,
      unreadOnly: false,
    });
  });

  it("returns zero unreadCount when no notifications", async () => {
    mocks.list.mockResolvedValueOnce([]);
    mocks.countUnread.mockResolvedValueOnce(0);
    const { notificationsListHandler } =
      await import("../notificationsListHandler");
    const response = await notificationsListHandler.handle(
      new Request("http://localhost/notifications", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    const data = (await response.json()) as any;
    expect(data.data).toEqual([]);
    expect(data.unreadCount).toBe(0);
  });
});

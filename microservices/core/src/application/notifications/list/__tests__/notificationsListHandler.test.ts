/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InvalidCursorError } from "../../../repositories/notificationRepository";

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

vi.mock("../../../repositories/notificationRepository", async (orig) => {
  // Keep the real InvalidCursorError so `instanceof` checks in the
  // handler match what the test throws.
  const actual =
    await orig<typeof import("../../../repositories/notificationRepository")>();
  return {
    ...actual,
    NotificationRepository: vi.fn().mockImplementation(() => mocks),
  };
});

const sampleRow = {
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
};

describe("NotificationsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue({ rows: [sampleRow], nextCursor: null });
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

  it("returns 200 with { rows, nextCursor, unreadCount }", async () => {
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
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.rows[0].id).toBe("n1");
    expect(data.nextCursor).toBeNull();
    expect(data.unreadCount).toBe(1);
  });

  it("defaults to first page (no cursor, limit=50, unreadOnly=false)", async () => {
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
      cursor: undefined,
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
      cursor: undefined,
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
      cursor: undefined,
      unreadOnly: true,
    });
  });

  it("forwards the cursor and surfaces nextCursor (second page)", async () => {
    mocks.list.mockResolvedValueOnce({
      rows: [{ ...sampleRow, id: "n2" }],
      nextCursor: "CURSOR_FOR_PAGE_3",
    });
    const { notificationsListHandler } =
      await import("../notificationsListHandler");
    const response = await notificationsListHandler.handle(
      new Request("http://localhost/notifications?cursor=PAGE_2_TOKEN", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      limit: 50,
      cursor: "PAGE_2_TOKEN",
      unreadOnly: false,
    });
    const data = (await response.json()) as any;
    expect(data.rows[0].id).toBe("n2");
    expect(data.nextCursor).toBe("CURSOR_FOR_PAGE_3");
  });

  it("returns nextCursor=null on the last page", async () => {
    mocks.list.mockResolvedValueOnce({
      rows: [sampleRow],
      nextCursor: null,
    });
    const { notificationsListHandler } =
      await import("../notificationsListHandler");
    const response = await notificationsListHandler.handle(
      new Request("http://localhost/notifications?cursor=LAST_TOKEN", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    const data = (await response.json()) as any;
    expect(data.nextCursor).toBeNull();
  });

  it("maps a malformed cursor to 400 { error: 'Invalid cursor' }", async () => {
    mocks.list.mockRejectedValueOnce(new InvalidCursorError());
    const { notificationsListHandler } =
      await import("../notificationsListHandler");
    const response = await notificationsListHandler.handle(
      new Request("http://localhost/notifications?cursor=%%%not-base64%%%", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(400);
    const data = (await response.json()) as any;
    expect(data.error).toBe("Invalid cursor");
    // `countUnread` may run (it's fired in parallel with `list` — they're
    // independent queries), but its result is discarded on a bad cursor:
    // the 400 body carries only the error, never an unreadCount.
    expect(data.unreadCount).toBeUndefined();
  });

  it("re-throws non-cursor errors from the repository", async () => {
    mocks.list.mockRejectedValueOnce(new Error("db down"));
    const { notificationsListHandler } =
      await import("../notificationsListHandler");
    const response = await notificationsListHandler.handle(
      new Request("http://localhost/notifications", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    // Elysia maps an unhandled throw to a 500.
    expect(response.status).toBe(500);
  });

  it("returns zero unreadCount + empty rows when there are none", async () => {
    mocks.list.mockResolvedValueOnce({ rows: [], nextCursor: null });
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
    expect(data.rows).toEqual([]);
    expect(data.nextCursor).toBeNull();
    expect(data.unreadCount).toBe(0);
  });
});

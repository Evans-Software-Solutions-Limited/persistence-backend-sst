/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { markAllRead: vi.fn(), markRead: vi.fn() };

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

describe("NotificationsUpdateAllHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markAllRead.mockResolvedValue(5);
  });

  it("requires authentication", async () => {
    const { notificationsUpdateAllHandler } =
      await import("../notificationsUpdateAllHandler");
    const response = await notificationsUpdateAllHandler.handle(
      new Request("http://localhost/notifications/all", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 200 with { data: { updated: N } } on success", async () => {
    const { notificationsUpdateAllHandler } =
      await import("../notificationsUpdateAllHandler");
    const response = await notificationsUpdateAllHandler.handle(
      new Request("http://localhost/notifications/all", {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data).toEqual({ data: { updated: 5 } });
  });

  it("returns { updated: 0 } when there are no unread rows (idempotent replay)", async () => {
    mocks.markAllRead.mockResolvedValueOnce(0);
    const { notificationsUpdateAllHandler } =
      await import("../notificationsUpdateAllHandler");
    const response = await notificationsUpdateAllHandler.handle(
      new Request("http://localhost/notifications/all", {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.data.updated).toBe(0);
  });

  it("forwards JWT userId to the bulk mark-read", async () => {
    const { notificationsUpdateAllHandler } =
      await import("../notificationsUpdateAllHandler");
    await notificationsUpdateAllHandler.handle(
      new Request("http://localhost/notifications/all", {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(mocks.markAllRead).toHaveBeenCalledWith("test-user-id");
  });

  /**
   * Routing collision regression: when both `notificationsUpdateAllHandler`
   * and `notificationsUpdateHandler` are mounted on the same app, the
   * literal `/notifications/all` MUST hit the bulk handler — not the
   * `:id` handler with `id = "all"`.
   *
   * This test mounts both handlers in the same order as `api.ts` (bulk
   * before single) and hits the literal path. The bulk repository
   * method must fire; the single mark-read must NOT.
   */
  it("REGRESSION: /notifications/all does not match :id when both handlers are mounted", async () => {
    // Mount both handlers on a shared Elysia app, mirroring api.ts.
    const { default: Elysia } = await import("elysia");
    const { notificationsUpdateAllHandler } =
      await import("../notificationsUpdateAllHandler");
    const { notificationsUpdateHandler } =
      await import("../../update/notificationsUpdateHandler");
    const app = new Elysia()
      .use(notificationsUpdateAllHandler)
      .use(notificationsUpdateHandler);

    const response = await app.handle(
      new Request("http://localhost/notifications/all", {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.markAllRead).toHaveBeenCalledTimes(1);
    expect(mocks.markRead).not.toHaveBeenCalled();
  });
});

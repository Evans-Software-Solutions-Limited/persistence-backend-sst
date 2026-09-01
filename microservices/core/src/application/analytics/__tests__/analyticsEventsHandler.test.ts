/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitEvent = vi.fn(async () => undefined);
vi.mock("../emitEvent", () => ({ emitEvent }));
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (header?: string) =>
    header ? { sub: "jwt-user" } : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user),
}));

describe("analyticsEventsHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  const post = (body: unknown, auth = true) =>
    new Request("http://localhost/analytics/events", {
      method: "POST",
      headers: {
        ...(auth ? { authorization: "Bearer token" } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  it("requires auth", async () => {
    const { analyticsEventsHandler } =
      await import("../analyticsEventsHandler");
    expect(
      (
        await analyticsEventsHandler.handle(
          post({ name: "onboarding_completed" }, false),
        )
      ).status,
    ).toBe(401);
  });

  it("uses JWT userId and drops non-whitelisted PII properties", async () => {
    const { analyticsEventsHandler } =
      await import("../analyticsEventsHandler");
    const res = await analyticsEventsHandler.handle(
      post({
        name: "onboarding_page_viewed",
        properties: { page: "profile", email: "private@example.com" },
      }),
    );
    expect(res.status).toBe(202);
    expect(emitEvent).toHaveBeenCalledWith({
      name: "onboarding_page_viewed",
      userId: "jwt-user",
      source: "app",
      eventId: undefined,
      properties: { page: "profile" },
    });
  });

  it("drops free text hidden under an allowed key", async () => {
    const { analyticsEventsHandler } =
      await import("../analyticsEventsHandler");
    const res = await analyticsEventsHandler.handle(
      post({
        name: "onboarding_page_viewed",
        properties: {
          page: "Jane Smith DOB 1990-01-01 weight 80kg",
          intentKey: "nutrition_mealprint",
        },
      }),
    );
    expect(res.status).toBe(202);
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ properties: {} }),
    );
  });

  it("keeps only finite values valid for that event", async () => {
    const { analyticsEventsHandler } =
      await import("../analyticsEventsHandler");
    const res = await analyticsEventsHandler.handle(
      post({
        name: "onboarding_plan_selected",
        properties: {
          selectedTier: "premium_plus",
          page: "recommendation",
        },
      }),
    );
    expect(res.status).toBe(202);
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: { selectedTier: "premium_plus" },
      }),
    );
  });

  it("rejects event names outside the client allowlist", async () => {
    const { analyticsEventsHandler } =
      await import("../analyticsEventsHandler");
    const res = await analyticsEventsHandler.handle(
      post({ name: "subscription_purchased" }),
    );
    expect(res.status).toBe(422);
    expect(emitEvent).not.toHaveBeenCalled();
  });
});

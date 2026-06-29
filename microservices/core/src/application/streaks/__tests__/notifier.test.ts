import { describe, it, expect, vi } from "vitest";
import { StreakNotificationDispatcher } from "../notifier";
import type { StreakNotification } from "../engine";

describe("StreakNotificationDispatcher", () => {
  it("maps a StreakNotification onto NotificationDispatcher.createAndDispatch", async () => {
    const createAndDispatch = vi.fn(async () => ({}) as never);
    const fakeDispatcher = { createAndDispatch } as never;
    const dispatcher = new StreakNotificationDispatcher(fakeDispatcher);

    const n: StreakNotification = {
      userId: "u1",
      type: "streak_milestone",
      title: "Streak milestone!",
      message: "You hit a 4-week streak. Keep it going!",
      data: { threshold: 4 },
      relatedEntityId: "s1",
    };
    await dispatcher.notify(n);

    expect(createAndDispatch).toHaveBeenCalledWith("u1", {
      type: "streak_milestone",
      title: "Streak milestone!",
      message: "You hit a 4-week streak. Keep it going!",
      data: { threshold: 4 },
      relatedEntityType: "streak",
      relatedEntityId: "s1",
    });
  });

  it("constructs a default dispatcher when none is injected", () => {
    // Smoke: the default-arg path is exercised without throwing.
    expect(() => new StreakNotificationDispatcher()).not.toThrow();
  });
});

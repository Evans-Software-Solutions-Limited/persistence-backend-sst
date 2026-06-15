import { describe, it, expect, vi } from "vitest";
import { StreakNotificationDispatcher } from "../notifier";
import type { StreakNotification } from "../engine";

describe("StreakNotificationDispatcher", () => {
  it("maps a StreakNotification onto NotificationRepository.create", async () => {
    const create = vi.fn(async () => ({}) as never);
    const fakeRepo = { create } as never;
    const dispatcher = new StreakNotificationDispatcher(fakeRepo);

    const n: StreakNotification = {
      userId: "u1",
      type: "streak_milestone",
      title: "Streak milestone!",
      message: "You hit a 4-week streak. Keep it going!",
      data: { threshold: 4 },
      relatedEntityId: "s1",
    };
    await dispatcher.notify(n);

    expect(create).toHaveBeenCalledWith("u1", {
      type: "streak_milestone",
      title: "Streak milestone!",
      message: "You hit a 4-week streak. Keep it going!",
      data: { threshold: 4 },
      relatedEntityType: "streak",
      relatedEntityId: "s1",
    });
  });

  it("constructs a default repository when none is injected", () => {
    // Smoke: the default-arg path is exercised without throwing.
    expect(() => new StreakNotificationDispatcher()).not.toThrow();
  });
});

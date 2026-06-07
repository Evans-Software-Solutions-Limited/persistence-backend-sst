import {
  groupNotificationsByDate,
  relativeTime,
} from "@/application/notifications/grouping";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";

// Fixed reference clock: 2026-06-07T12:00:00Z
const NOW = Date.parse("2026-06-07T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("groupNotificationsByDate", () => {
  it("buckets into Today / Yesterday / This Week / Older in fixed order", () => {
    const groups = groupNotificationsByDate(
      [
        makeNotification({
          id: "today",
          createdAt: "2026-06-07T09:00:00.000Z",
        }),
        makeNotification({
          id: "yest",
          createdAt: "2026-06-06T09:00:00.000Z",
        }),
        makeNotification({
          id: "week",
          createdAt: "2026-06-03T09:00:00.000Z",
        }),
        makeNotification({
          id: "older",
          createdAt: "2026-05-01T09:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Yesterday",
      "This Week",
      "Older",
    ]);
    expect(groups[0].notifications[0].id).toBe("today");
    expect(groups[3].notifications[0].id).toBe("older");
  });

  it("drops empty groups", () => {
    const groups = groupNotificationsByDate(
      [makeNotification({ id: "t", createdAt: "2026-06-07T08:00:00.000Z" })],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
  });

  it("preserves input order within a group", () => {
    const groups = groupNotificationsByDate(
      [
        makeNotification({ id: "a", createdAt: "2026-06-07T10:00:00.000Z" }),
        makeNotification({ id: "b", createdAt: "2026-06-07T08:00:00.000Z" }),
      ],
      NOW,
    );
    expect(groups[0].notifications.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("puts rows with an unparseable createdAt into Older", () => {
    const groups = groupNotificationsByDate(
      [makeNotification({ id: "bad", createdAt: "not-a-date" })],
      NOW,
    );
    expect(groups).toEqual([
      { label: "Older", notifications: expect.any(Array) },
    ]);
    expect(groups[0].notifications[0].id).toBe("bad");
  });

  it("returns [] for no notifications", () => {
    expect(groupNotificationsByDate([], NOW)).toEqual([]);
  });
});

describe("relativeTime", () => {
  it("formats sub-minute as 'now'", () => {
    expect(relativeTime("2026-06-07T11:59:30.000Z", NOW)).toBe("now");
  });
  it("formats minutes / hours / days / weeks", () => {
    expect(relativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe(
      "5m",
    );
    expect(relativeTime(new Date(NOW - 3 * HOUR).toISOString(), NOW)).toBe(
      "3h",
    );
    expect(relativeTime(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe("2d");
    expect(relativeTime(new Date(NOW - 14 * DAY).toISOString(), NOW)).toBe(
      "2w",
    );
  });
  it("falls back to a short date beyond ~4 weeks", () => {
    const out = relativeTime(new Date(NOW - 60 * DAY).toISOString(), NOW);
    expect(out).not.toMatch(/^\d+[mhdw]$/);
    expect(out.length).toBeGreaterThan(0);
  });
  it("clamps future timestamps to 'now'", () => {
    expect(relativeTime(new Date(NOW + 10 * 60_000).toISOString(), NOW)).toBe(
      "now",
    );
  });
  it("returns '' for an unparseable date", () => {
    expect(relativeTime("nope", NOW)).toBe("");
  });
});

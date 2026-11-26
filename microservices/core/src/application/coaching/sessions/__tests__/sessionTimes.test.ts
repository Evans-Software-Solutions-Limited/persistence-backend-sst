import { describe, expect, it } from "vitest";
import {
  daysBetween,
  localDayBounds,
  localHhmm,
  shiftLikeLocal,
  weeklyStarts,
} from "../sessionTimes";
import {
  formatWhen,
  kindLabel,
  sessionPushText,
} from "../sessionNotifications";

describe("sessionTimes", () => {
  it("keeps a weekly repeat at the local time across the autumn change (New York)", () => {
    // Tue 27 Oct 2026 07:30 EDT; New York goes back on 1 Nov.
    const starts = weeklyStarts(
      new Date("2026-10-27T11:30:00Z"),
      3,
      "America/New_York",
    );
    expect(starts.map((d) => d.toISOString())).toEqual([
      "2026-10-27T11:30:00.000Z",
      "2026-11-03T12:30:00.000Z",
      "2026-11-10T12:30:00.000Z",
    ]);
    expect(starts.map((d) => localHhmm(d, "America/New_York"))).toEqual([
      "07:30",
      "07:30",
      "07:30",
    ]);
  });

  it("moves another occurrence the same local way", () => {
    // Tue 09:00 → Thu 18:15 London; a later Tuesday in BST follows.
    const moved = shiftLikeLocal(
      new Date("2027-04-06T08:00:00Z"),
      new Date("2027-03-23T09:00:00Z"),
      new Date("2027-03-25T18:15:00Z"),
      "Europe/London",
    );
    expect(moved.toISOString()).toBe("2027-04-08T17:15:00.000Z");
    expect(daysBetween("2027-03-23", "2027-03-25")).toBe(2);
    expect(daysBetween("2027-03-25", "2027-03-23")).toBe(-2);
  });

  it("finds today's bounds on a 23-hour day", () => {
    const { start, end } = localDayBounds(
      new Date("2027-03-28T12:00:00Z"),
      "Europe/London",
    );
    expect(start.toISOString()).toBe("2027-03-28T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-03-28T23:00:00.000Z");
  });
});

describe("session push text", () => {
  const base = {
    coachName: "Ellie",
    startsAt: new Date("2027-03-23T09:00:00Z"),
    timeZone: "Europe/London",
  };

  it("labels every kind, with a fallback", () => {
    expect(kindLabel("video")).toBe("Video call");
    expect(kindLabel("check_in_call")).toBe("Check-in call");
    expect(kindLabel("own_training")).toBe("Training");
    expect(kindLabel("something_new")).toBe("Session");
  });

  it("writes each action", () => {
    expect(sessionPushText("booked", { ...base, kind: "video" })).toEqual({
      title: "Ellie booked a session with you",
      body: "Video call · Tue 23 Mar, 09:00",
    });
    expect(
      sessionPushText("booked", { ...base, kind: "video", occurrences: 1 })
        .body,
    ).toBe("Video call · Tue 23 Mar, 09:00");
    expect(
      sessionPushText("reminder", {
        ...base,
        kind: "check_in_call",
        location: "  ",
      }),
    ).toEqual({
      title: "Session with Ellie soon",
      body: "Check-in call · Tue 23 Mar, 09:00",
    });
    expect(sessionPushText("reminder", { ...base, kind: "video" }).body).toBe(
      "Video call · Tue 23 Mar, 09:00",
    );
  });

  it("formats in the athlete's zone, falling back to the default zone", () => {
    expect(formatWhen(base.startsAt, "Asia/Tokyo")).toBe("Tue 23 Mar, 18:00");
    expect(formatWhen(base.startsAt, "Not/AZone")).toBe(
      formatWhen(base.startsAt, "Europe/London"),
    );
  });
});

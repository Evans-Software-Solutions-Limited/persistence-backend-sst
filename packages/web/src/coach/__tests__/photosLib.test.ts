import { describe, expect, it } from "vitest";
import {
  cadenceLabel,
  compareStats,
  dateLabel,
  daysBetween,
  defaultPair,
  denialOf,
  newestFirst,
  orderedPair,
  photoFor,
} from "../photos/lib";
import { apiError } from "./helpers";
import { photoSet } from "./photosFixtures";

describe("photos lib (PER-138)", () => {
  it("maps the server's refusals to the tab's states, and nothing else", () => {
    expect(denialOf(apiError(403, { code: "photos_off" }))).toBe("photos_off");
    expect(denialOf(apiError(403, { code: "photo_sharing_not_granted" }))).toBe(
      "not_shared",
    );
    expect(denialOf(apiError(403, { code: "not_your_client" }))).toBe("ended");
    expect(denialOf(apiError(403, { code: "account_deleted" }))).toBe("ended");
    expect(denialOf(apiError(403, { code: "not_a_trainer" }))).toBeNull();
    expect(denialOf(apiError(403, null))).toBeNull();
    expect(denialOf(apiError(500, { code: "photos_off" }))).toBeNull();
    expect(denialOf(new Error("boom"))).toBeNull();
    expect(denialOf(null)).toBeNull();
  });

  it("labels dates without a time zone shift and counts days", () => {
    expect(dateLabel("2026-10-26")).toBe("26 Oct");
    expect(dateLabel("2026-01-01")).toBe("1 Jan");
    expect(daysBetween("2026-09-15", "2026-10-26")).toBe(41);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("keeps ready sets, newest first, same-day sets by when they were added", () => {
    const sets = newestFirst([
      photoSet("a", "2026-10-12"),
      photoSet("p", "2026-10-30", { status: "pending" }),
      photoSet("b", "2026-10-26"),
      photoSet("c", "2026-10-26", { createdAt: "2026-10-26T20:00:00.000Z" }),
    ]);
    expect(sets.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("says how many sets and how often (canvas: 6 sets · every 1–2 weeks)", () => {
    expect(cadenceLabel([])).toBe("0 sets");
    expect(cadenceLabel([photoSet("a", "2026-10-26")])).toBe("1 set");
    const canvas = [
      "2026-10-26",
      "2026-10-19",
      "2026-10-12",
      "2026-10-05",
      "2026-09-28",
      "2026-09-15",
    ].map((d, i) => photoSet(`s${i}`, d));
    expect(cadenceLabel(canvas)).toBe("6 sets · every 1–2 weeks");
    expect(cadenceLabel(canvas.slice(0, 3))).toBe("3 sets · every week");
    expect(
      cadenceLabel([photoSet("a", "2026-10-26"), photoSet("b", "2026-10-05")]),
    ).toBe("2 sets · every 3 weeks");
  });

  it("finds a pose's photo", () => {
    const s = photoSet("a", "2026-10-26");
    expect(photoFor(s, "side")?.id).toBe("a-side");
    expect(photoFor({ ...s, photos: [] }, "side")).toBeNull();
    expect(photoFor(null, "front")).toBeNull();
  });

  it("compares the first and the latest by default, always older first", () => {
    const sets = [
      photoSet("new", "2026-10-26"),
      photoSet("mid", "2026-10-12"),
      photoSet("old", "2026-09-15"),
    ];
    expect(defaultPair(sets.slice(0, 1))).toBeNull();
    expect(defaultPair(sets)).toEqual(["old", "new"]);
    expect(orderedPair(sets, null)?.map((s) => s.id)).toEqual(["old", "new"]);
    expect(orderedPair(sets, ["new", "mid"])?.map((s) => s.id)).toEqual([
      "mid",
      "new",
    ]);
    // A set the client deleted, or the same set twice: back to the default.
    expect(orderedPair(sets, ["gone", "new"])?.map((s) => s.id)).toEqual([
      "old",
      "new",
    ]);
    expect(orderedPair(sets, ["mid", "mid"])?.map((s) => s.id)).toEqual([
      "old",
      "new",
    ]);
    expect(orderedPair(sets.slice(0, 1), null)).toBeNull();
  });

  it("builds the strip: weight, body fat and weeks (or days) apart", () => {
    const older = photoSet("o", "2026-09-15", {
      weight: { kg: 80.2, measuredAt: "2026-09-15T07:00:00.000Z" },
      bodyFat: { percentage: 15.2, measuredAt: "2026-09-15T07:00:00.000Z" },
    });
    const newer = photoSet("n", "2026-10-26", {
      weight: { kg: 82.4, measuredAt: "2026-10-26T07:00:00.000Z" },
      bodyFat: { percentage: 14.5, measuredAt: "2026-10-26T07:00:00.000Z" },
    });
    expect(compareStats(older, newer)).toEqual({
      weight: { from: "80.2", to: "82.4" },
      bodyFat: { from: "15.2", to: "14.5" },
      apart: { value: "6", unit: "wk" },
    });
    const soon = photoSet("s", "2026-09-18");
    expect(compareStats(older, soon)).toEqual({
      weight: { from: "80.2", to: "–" },
      bodyFat: { from: "15.2", to: "–" },
      apart: { value: "3", unit: "d" },
    });
  });
});

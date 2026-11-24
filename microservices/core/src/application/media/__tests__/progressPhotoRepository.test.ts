import { describe, expect, it, vi } from "vitest";

vi.mock("sst", () => ({
  Resource: { CoachPrivateMedia: { name: "private-media-test" } },
}));

import {
  nearestMeasurement,
  photoKey,
  validatePoses,
  validTakenOn,
  type PoseInput,
} from "../progressPhotoRepository";
import { photoAnswerMediaId } from "../privateMediaRepository";

const m = (
  iso: string,
  weightKg: string | null,
  bodyFat: string | null = null,
) => ({
  measuredAt: new Date(iso),
  weightKg,
  bodyFatPercentage: bodyFat,
});
const weight = (row: { weightKg: string | null }) =>
  row.weightKg === null ? null : Number(row.weightKg);

describe("nearestMeasurement (design F test 5)", () => {
  it("picks the closest within 7 days; a tie goes to the earlier one", () => {
    const rows = [
      m("2026-11-17T12:00:00Z", "81"),
      m("2026-11-23T12:00:00Z", "79"),
      m("2026-11-19T12:00:00Z", null, "20"),
    ];
    expect(nearestMeasurement("2026-11-20", rows, weight)).toEqual({
      value: 81,
      measuredAt: new Date("2026-11-17T12:00:00Z"),
    });
  });

  it("accepts the edge of the window and refuses beyond it", () => {
    expect(
      nearestMeasurement(
        "2026-11-20",
        [m("2026-11-27T23:59:00Z", "80")],
        weight,
      ),
    ).not.toBeNull();
    expect(
      nearestMeasurement(
        "2026-11-20",
        [m("2026-11-28T00:01:00Z", "80")],
        weight,
      ),
    ).toBeNull();
    expect(nearestMeasurement("2026-11-20", [], weight)).toBeNull();
  });
});

describe("validTakenOn", () => {
  const now = new Date("2026-11-23T10:00:00Z");
  it.each([
    ["2026-11-23", true],
    ["2026-11-24", true], // tomorrow: a time zone ahead of UTC
    ["2026-11-25", false],
    ["2026-13-01", false],
    ["2026-02-29", false],
    ["2024-02-29", true],
    ["1970-01-01", true],
    ["1969-12-31", false],
    ["2026-1-01", false],
  ])("%s → %s", (raw, ok) => {
    expect(validTakenOn(raw, now)).toBe(ok);
  });
});

describe("validatePoses", () => {
  it("refuses an unknown pose", () => {
    const poses = [
      { pose: "top", bytes: 1 },
      { pose: "side", bytes: 1 },
      { pose: "back", bytes: 1 },
    ] as unknown as PoseInput[];
    expect(validatePoses(poses)).toEqual([
      { at: "poses.0.pose", message: "must be front, side or back" },
      { at: "poses", message: "front is missing" },
    ]);
  });

  it("refuses a fractional size", () => {
    expect(
      validatePoses([
        { pose: "front", bytes: 1.5 },
        { pose: "side", bytes: 1 },
        { pose: "back", bytes: 1 },
      ]),
    ).toEqual([
      { at: "poses.0.bytes", message: "must be 1 to 10485760 bytes" },
    ]);
  });
});

describe("keys and photo answer ids", () => {
  it("builds progress/<user>/<set>/<pose>.jpg", () => {
    expect(photoKey("u", "s", "side")).toBe("progress/u/s/side.jpg");
  });

  it("reads {mediaId} or a bare id, lower-cased, and nothing else", () => {
    const id = "A1B2C3D4-0000-4000-8000-000000000000";
    expect(photoAnswerMediaId({ mediaId: id })).toBe(id.toLowerCase());
    expect(photoAnswerMediaId(id)).toBe(id.toLowerCase());
    for (const bad of [null, 5, [id], { mediaId: 5 }, { id }, "nope"]) {
      expect(photoAnswerMediaId(bad)).toBeNull();
    }
  });
});

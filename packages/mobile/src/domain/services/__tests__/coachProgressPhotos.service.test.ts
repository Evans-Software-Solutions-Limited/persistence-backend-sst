import type { ProgressPhotoSet } from "@/domain/models/progressPhotos";
import {
  coachSetsNewestFirst,
  compareStrip,
  daysBetween,
  defaultComparePair,
  denialFromResponse,
  orderedComparePair,
  photoForPose,
} from "../coachProgressPhotos.service";

function set(
  id: string,
  takenOn: string,
  over: Partial<ProgressPhotoSet> = {},
): ProgressPhotoSet {
  return {
    id,
    takenOn,
    source: "self",
    status: "ready",
    createdAt: `${takenOn}T08:00:00.000Z`,
    updatedAt: `${takenOn}T08:00:00.000Z`,
    photos: (["front", "side", "back"] as const).map((pose) => ({
      id: `${id}-${pose}`,
      pose,
      bytes: 10,
      width: null,
      height: null,
      url: `https://view.test/${id}/${pose}.jpg`,
      expiresAt: "2099-01-01T00:00:00.000Z",
    })),
    weight: null,
    bodyFat: null,
    ...over,
  };
}

describe("coach progress photos (PER-138)", () => {
  it("maps only the photo 403s to denials", () => {
    expect(denialFromResponse(403, "photos_off")).toBe("photos_off");
    expect(denialFromResponse(403, "photo_sharing_not_granted")).toBe(
      "not_shared",
    );
    expect(denialFromResponse(403, "not_your_client")).toBe("ended");
    expect(denialFromResponse(403, "account_deleted")).toBe("ended");
    expect(denialFromResponse(403, "not_a_trainer")).toBeUndefined();
    expect(denialFromResponse(403, undefined)).toBeUndefined();
    expect(denialFromResponse(404, "photos_off")).toBeUndefined();
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-09-15", "2026-10-26")).toBe(41);
    expect(daysBetween("2026-10-26", "2026-10-19")).toBe(-7);
  });

  it("keeps ready sets, newest first, same-day sets by when they were added", () => {
    expect(
      coachSetsNewestFirst([
        set("a", "2026-10-12"),
        set("p", "2026-10-30", { status: "pending" }),
        set("b", "2026-10-26"),
        set("c", "2026-10-26", { createdAt: "2026-10-26T20:00:00.000Z" }),
      ]).map((s) => s.id),
    ).toEqual(["c", "b", "a"]);
  });

  it("finds a pose's photo", () => {
    expect(photoForPose(set("a", "2026-10-26"), "back")?.id).toBe("a-back");
    expect(
      photoForPose({ ...set("a", "2026-10-26"), photos: [] }, "back"),
    ).toBeNull();
    expect(photoForPose(null, "front")).toBeNull();
  });

  it("pairs the first and latest by default, always older first", () => {
    const sets = [
      set("new", "2026-10-26"),
      set("mid", "2026-10-12"),
      set("old", "2026-09-15"),
    ];
    expect(defaultComparePair(sets.slice(0, 1))).toBeNull();
    expect(defaultComparePair(sets)).toEqual(["old", "new"]);
    const ids = (pair: [string, string] | null) =>
      orderedComparePair(sets, pair)?.map((s) => s.id);
    expect(ids(null)).toEqual(["old", "new"]);
    expect(ids(["new", "mid"])).toEqual(["mid", "new"]);
    expect(ids(["gone", "mid"])).toEqual(["old", "new"]);
    expect(ids(["mid", "mid"])).toEqual(["old", "new"]);
    expect(orderedComparePair([], null)).toBeNull();
  });

  it("builds the strip in the coach's unit, with weeks or days apart", () => {
    const older = set("o", "2026-09-15", {
      weight: { kg: 80.2, measuredAt: "2026-09-15T07:00:00.000Z" },
      bodyFat: { percentage: 15.2, measuredAt: "2026-09-15T07:00:00.000Z" },
    });
    const newer = set("n", "2026-10-26", {
      weight: { kg: 82.4, measuredAt: "2026-10-26T07:00:00.000Z" },
      bodyFat: { percentage: 14.5, measuredAt: "2026-10-26T07:00:00.000Z" },
    });
    expect(compareStrip(older, newer)).toEqual({
      weight: { from: "80.2", to: "82.4" },
      bodyFat: { from: "15.2", to: "14.5" },
      apart: { value: "6", unit: "wk" },
    });
    expect(compareStrip(older, newer, (kg) => kg * 2).weight).toEqual({
      from: "160.4",
      to: "164.8",
    });
    expect(compareStrip(older, set("s", "2026-09-17"))).toEqual({
      weight: { from: "80.2", to: "–" },
      bodyFat: { from: "15.2", to: "–" },
      apart: { value: "2", unit: "d" },
    });
  });
});

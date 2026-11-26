import type {
  PendingProgressPhotoSet,
  ProgressPhotoSet,
  ProgressPhotosCache,
} from "@/domain/models/progressPhotos";
import {
  coachesToAskAboutSharing,
  EMPTY_PROGRESS_PHOTOS,
  gallerySets,
  mergeProgressPhotosResponse,
  nextUploadDelayMs,
  photoDateLabel,
  UPLOAD_BACKOFF_MS,
  weightNear,
  weightVsLatestKg,
  withoutSet,
  withSet,
  withSharingAnswered,
} from "../progressPhotos.service";

function set(
  id: string,
  takenOn: string,
  extra: Partial<ProgressPhotoSet> = {},
): ProgressPhotoSet {
  return {
    id,
    takenOn,
    source: "self",
    status: "ready",
    createdAt: `${takenOn}T09:00:00.000Z`,
    updatedAt: `${takenOn}T09:00:00.000Z`,
    photos: (["back", "front", "side"] as const).map((pose) => ({
      id: `${id}-${pose}`,
      pose,
      bytes: 100,
      width: 1536,
      height: 2048,
      url: `https://view.test/${id}/${pose}.jpg`,
      expiresAt: "2026-11-25T10:15:00.000Z",
    })),
    weight: { kg: 82.4, measuredAt: `${takenOn}T07:00:00.000Z` },
    bodyFat: { percentage: 14.8, measuredAt: `${takenOn}T07:00:00.000Z` },
    ...extra,
  };
}

function pending(
  id: string,
  takenOn: string,
  extra: Partial<PendingProgressPhotoSet> = {},
): PendingProgressPhotoSet {
  return {
    id,
    userId: "u1",
    takenOn,
    clientRequestId: id.replace("local-", ""),
    photos: (["side", "front", "back"] as const).map((pose) => ({
      pose,
      uri: `file:///cache/${id}-${pose}.jpg`,
      bytes: 100,
      width: 1536,
      height: 2048,
    })),
    serverSetId: null,
    attempts: 0,
    nextAttemptAt: "2026-11-25T10:00:00.000Z",
    lastError: null,
    failed: null,
    createdAt: `${takenOn}T12:00:00.000Z`,
    ...extra,
  };
}

const sharing = (needsPrompt: boolean) => ({
  needsPrompt,
  coaches: [
    { trainerId: "t1", name: "Ana", sharing: true },
    { trainerId: "t2", name: "Ben", sharing: !needsPrompt },
  ],
  consentVersion: "v0",
  copy: "Share?",
});

describe("nextUploadDelayMs", () => {
  it("backs off and settles at the last step", () => {
    expect(nextUploadDelayMs(0)).toBe(UPLOAD_BACKOFF_MS[0]);
    expect(nextUploadDelayMs(1)).toBe(5_000);
    expect(nextUploadDelayMs(2)).toBe(30_000);
    expect(nextUploadDelayMs(99)).toBe(3_600_000);
  });
});

describe("mergeProgressPhotosResponse", () => {
  it("keeps ready sets newest first, drops sets being deleted, keeps answers", () => {
    const prev: ProgressPhotosCache = {
      ...EMPTY_PROGRESS_PHOTOS,
      sharingPromptAnsweredFor: ["t2"],
    };
    const merged = mergeProgressPhotosResponse(
      prev,
      {
        sets: [
          set("a", "2026-10-11"),
          set("b", "2026-10-25"),
          set("c", "2026-10-25", {
            createdAt: "2026-10-25T18:00:00.000Z",
          }),
          set("p", "2026-11-01", { status: "pending" }),
          set("d", "2026-11-02"),
        ],
        photoSharing: sharing(true),
        asOf: "2026-11-25T10:00:00.000Z",
      },
      new Set(["d"]),
    );
    expect(merged.sets.map((s) => s.id)).toEqual(["c", "b", "a"]);
    expect(merged.sharingPromptAnsweredFor).toEqual(["t2"]);
    expect(merged.asOf).toBe("2026-11-25T10:00:00.000Z");
  });

  it("keeps cached sets that finished after the read began", () => {
    const prev = withSet(
      withSet(
        withSet(
          withSet(null, set("old", "2026-10-01")),
          set("new", "2026-11-25", { updatedAt: "2026-11-25T10:00:05.000Z" }),
        ),
        set("gone", "2026-11-24", { updatedAt: "2026-11-25T10:00:06.000Z" }),
      ),
      set("deleting", "2026-11-23", { updatedAt: "2026-11-25T10:00:07.000Z" }),
    );
    const res = {
      sets: [set("b", "2026-10-25")],
      deletedIds: ["gone"],
      photoSharing: sharing(false),
      asOf: "2026-11-25T10:00:00.000Z",
    };
    // "old" predates the read, so its absence means it's gone.
    expect(
      mergeProgressPhotosResponse(prev, res, new Set(["deleting"])).sets.map(
        (s) => s.id,
      ),
    ).toEqual(["new", "b"]);
    // Without an asOf nothing is kept from before.
    expect(
      mergeProgressPhotosResponse(
        prev,
        { ...res, asOf: "" },
        new Set(),
      ).sets.map((s) => s.id),
    ).toEqual(["b"]);
  });

  it("starts with no answers without a previous cache", () => {
    const merged = mergeProgressPhotosResponse(
      null,
      { sets: [], photoSharing: sharing(false), asOf: "x" },
      new Set(),
    );
    expect(merged.sharingPromptAnsweredFor).toEqual([]);
  });
});

describe("withSet / withoutSet", () => {
  it("adds, replaces and removes sets", () => {
    const one = withSet(null, set("a", "2026-10-11"));
    const two = withSet(one, set("b", "2026-10-25"));
    expect(two.sets.map((s) => s.id)).toEqual(["b", "a"]);
    const replaced = withSet(two, set("a", "2026-10-11", { weight: null }));
    expect(replaced.sets.find((s) => s.id === "a")?.weight).toBeNull();
    expect(withoutSet(replaced, "b").sets.map((s) => s.id)).toEqual(["a"]);
    expect(withoutSet(null, "x").sets).toEqual([]);
  });
});

describe("coachesToAskAboutSharing", () => {
  it("asks about coaches without a grant who weren't answered", () => {
    expect(coachesToAskAboutSharing(null)).toEqual([]);
    const cache = { ...EMPTY_PROGRESS_PHOTOS, photoSharing: sharing(true) };
    expect(coachesToAskAboutSharing(cache)).toEqual(["t2"]);
    expect(
      coachesToAskAboutSharing({ ...cache, sharingPromptAnsweredFor: ["t2"] }),
    ).toEqual([]);
    expect(
      coachesToAskAboutSharing({
        ...EMPTY_PROGRESS_PHOTOS,
        photoSharing: sharing(false),
      }),
    ).toEqual([]);
  });

  it("records answers; a grant marks every coach as sharing", () => {
    const cache = { ...EMPTY_PROGRESS_PHOTOS, photoSharing: sharing(true) };
    const declined = withSharingAnswered(cache, ["t2"], false);
    expect(declined.photoSharing?.needsPrompt).toBe(true);
    expect(declined.sharingPromptAnsweredFor).toEqual(["t2"]);
    const granted = withSharingAnswered(declined, ["t2", "t3"], true);
    expect(granted.photoSharing?.needsPrompt).toBe(false);
    expect(granted.photoSharing?.coaches.every((c) => c.sharing)).toBe(true);
    expect(granted.sharingPromptAnsweredFor).toEqual(["t2", "t3"]);
    expect(withSharingAnswered(null, ["t1"], true).photoSharing).toBeNull();
  });
});

describe("gallerySets", () => {
  it("merges server and phone sets newest first, poses in order", () => {
    const cache = withSet(
      withSet(null, set("a", "2026-10-11")),
      set("b", "2026-11-20"),
    );
    const rows = gallerySets(cache, [
      pending("local-1", "2026-11-25"),
      pending("local-2", "2026-10-01", { failed: "rejected" }),
      // Its server copy is cached already: show it once.
      pending("local-3", "2026-11-20", { serverSetId: "b" }),
    ]);
    expect(rows.map((r) => [r.id, r.upload])).toEqual([
      ["local-1", "uploading"],
      ["b", "done"],
      ["a", "done"],
      ["local-2", "failed"],
    ]);
    expect(rows[0]!.photos.map((p) => p.pose)).toEqual([
      "front",
      "side",
      "back",
    ]);
    expect(rows[0]!.photos[0]!.cacheKey).toBe(
      "file:///cache/local-1-front.jpg",
    );
    expect(rows[1]!.photos.map((p) => p.cacheKey)).toEqual([
      "b-front",
      "b-side",
      "b-back",
    ]);
    expect(rows[1]!.weightKg).toBe(82.4);
    expect(rows[1]!.bodyFat).toBe(14.8);
    expect(rows[0]!.weightKg).toBeNull();
  });

  it("handles no cache and sets without measurements", () => {
    expect(gallerySets(null, [])).toEqual([]);
    const rows = gallerySets(
      withSet(null, set("a", "2026-10-11", { weight: null, bodyFat: null })),
      [],
    );
    expect(rows[0]!.weightKg).toBeNull();
    expect(rows[0]!.bodyFat).toBeNull();
  });
});

describe("labels and numbers", () => {
  it("formats dates", () => {
    expect(photoDateLabel("2026-10-25")).toBe("25 Oct");
    expect(photoDateLabel("2026-01-05", true)).toBe("5 Jan 2026");
  });

  it("works out the change vs the latest set", () => {
    const [latest, older] = gallerySets(
      withSet(
        withSet(
          null,
          set("a", "2026-10-11", { weight: { kg: 81.9, measuredAt: "x" } }),
        ),
        set("b", "2026-10-25"),
      ),
      [],
    );
    expect(weightVsLatestKg(older!, latest!)).toBeCloseTo(-0.5);
    expect(weightVsLatestKg({ ...older!, weightKg: null }, latest!)).toBeNull();
  });

  it("finds the weight nearest a day within 7 days", () => {
    const points = [
      { date: "2026-11-10", weightKg: 80 },
      { date: "2026-11-22", weightKg: 82 },
      { date: "2026-11-27", weightKg: 83 },
      { date: "2026-11-24", weightKg: null },
      { date: "not-a-date", weightKg: 99 },
    ];
    expect(weightNear(points, "2026-11-25")).toBe(83);
    expect(weightNear(points, "2026-11-23")).toBe(82);
    expect(weightNear(points, "2026-12-30")).toBeNull();
    // A tie goes to the later reading.
    expect(
      weightNear(
        [
          { date: "2026-11-23", weightKg: 81 },
          { date: "2026-11-27", weightKg: 84 },
        ],
        "2026-11-25",
      ),
    ).toBe(84);
  });
});

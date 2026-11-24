import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sst", () => ({
  Resource: { CoachPrivateMedia: { name: "private-media-test" } },
}));

import {
  checkUpload,
  COACH_VIEW_SECONDS,
  deleteAllUserMedia,
  deleteKeys,
  deletePrefix,
  OWNER_VIEW_SECONDS,
  presignUpload,
  presignView,
  setS3ClientForTests,
  userPrefixes,
} from "../privateMediaStore";
import { FakeBucket } from "./fakeS3";

let bucket: FakeBucket;

beforeEach(() => {
  bucket = new FakeBucket();
  setS3ClientForTests(bucket.client());
});

afterEach(() => setS3ClientForTests(null));

const params = (url: string) => new URL(url).searchParams;

describe("presignUpload (design F: pinned to key, type and size)", () => {
  it("signs the staging key, Content-Type and Content-Length, for 10 minutes", async () => {
    const now = new Date("2026-11-23T10:00:00Z");
    const upload = await presignUpload(
      "progress/u1/s1/front.jpg",
      "image/jpeg",
      123456,
      now,
    );
    const url = new URL(upload.url);
    expect(url.host).toBe("private-media-test.s3.eu-west-2.amazonaws.com");
    // Uploads land under pending/; only complete writes the final key.
    expect(url.pathname).toBe("/pending/progress/u1/s1/front.jpg");
    const q = params(upload.url);
    expect(q.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host",
    );
    expect(q.get("X-Amz-Expires")).toBe("600");
    // No checksum of an empty body baked into the link.
    expect(q.has("x-amz-checksum-crc32")).toBe(false);
    expect(upload).toMatchObject({
      method: "PUT",
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": "123456",
      },
      expiresAt: "2026-11-23T10:10:00.000Z",
    });
  });
});

describe("presignView", () => {
  it("lasts 15 minutes for the owner and 5 for a coach", async () => {
    const now = new Date("2026-11-23T10:00:00Z");
    const owner = await presignView("forms/u1/m1.jpg", OWNER_VIEW_SECONDS, now);
    const coach = await presignView("forms/u1/m1.jpg", COACH_VIEW_SECONDS, now);
    expect(params(owner.url).get("X-Amz-Expires")).toBe("900");
    expect(params(coach.url).get("X-Amz-Expires")).toBe("300");
    expect(owner.expiresAt).toBe("2026-11-23T10:15:00.000Z");
    expect(coach.expiresAt).toBe("2026-11-23T10:05:00.000Z");
  });
});

describe("checkUpload (HeadObject on complete)", () => {
  const expected = {
    contentTypes: ["image/jpeg"],
    maxBytes: 10 * 1024 * 1024,
    bytes: 500,
  };

  it("accepts a matching staged object and promotes it to the final key", async () => {
    bucket.put("pending/progress/u/s/front.jpg", "image/jpeg", 500);
    expect(await checkUpload("progress/u/s/front.jpg", expected)).toEqual({
      ok: true,
      bytes: 500,
    });
    expect(bucket.keys()).toEqual(["progress/u/s/front.jpg"]);
    expect(bucket.objects.get("progress/u/s/front.jpg")!.contentType).toBe(
      "image/jpeg",
    );
  });

  it("counts an already-promoted object as done (complete retried after the copy)", async () => {
    bucket.put("k", "image/jpeg", 500, { upload: "complete" });
    expect(await checkUpload("k", expected)).toEqual({ ok: true, bytes: 500 });
    expect(bucket.sent).not.toContain("CopyObjectCommand");
  });

  it("a late duplicate PUT only reaches pending/, which the lifecycle rule clears", async () => {
    bucket.put("pending/k", "image/jpeg", 500);
    await checkUpload("k", expected);
    bucket.put("pending/k", "image/jpeg", 500); // the late PUT
    expect(bucket.expireLifecycle()).toEqual(["pending/k"]);
    expect(bucket.keys()).toEqual(["k"]);
  });

  it("reports a missing object", async () => {
    expect(await checkUpload("k", expected)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("refuses the wrong type, an oversize object and a size mismatch, and deletes the staged upload", async () => {
    bucket.put("pending/png", "image/png", 500);
    bucket.put("pending/big", "image/jpeg", 10 * 1024 * 1024 + 1);
    bucket.put("pending/odd", "image/jpeg", 499);
    expect(await checkUpload("png", expected)).toMatchObject({
      reason: "wrong_type",
    });
    expect(
      await checkUpload("big", { ...expected, bytes: 10 * 1024 * 1024 + 1 }),
    ).toMatchObject({ reason: "too_large" });
    expect(await checkUpload("odd", expected)).toMatchObject({
      reason: "size_mismatch",
    });
    expect(bucket.keys()).toEqual([]);
  });

  it("treats a missing content type as the wrong type", async () => {
    bucket.put("k", "", 500);
    expect(await checkUpload("k", expected)).toMatchObject({
      reason: "wrong_type",
    });
  });

  it("treats a missing size as 0 bytes", async () => {
    bucket.put("k", "image/jpeg", Number.NaN);
    expect(await checkUpload("k", expected)).toMatchObject({
      reason: "size_mismatch",
    });
  });

  it("recognises a not-found reported only by its HTTP status", async () => {
    bucket.failures.set(
      "HeadObjectCommand",
      Object.assign(new Error("Unknown"), {
        $metadata: { httpStatusCode: 404 },
      }),
    );
    expect(await checkUpload("k", expected)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("rethrows S3 errors other than not-found", async () => {
    bucket.failures.set("HeadObjectCommand", new Error("throttled"));
    await expect(checkUpload("k", expected)).rejects.toThrow("throttled");
  });
});

describe("deleting objects", () => {
  it("deleteKeys ignores missing keys and does nothing for an empty list", async () => {
    bucket.put("a", "image/jpeg", 1);
    await deleteKeys(["a", "missing"]);
    await deleteKeys([]);
    expect(bucket.keys()).toEqual([]);
    expect(bucket.sent).toEqual(["DeleteObjectsCommand"]);
  });

  it("deleteKeys throws when S3 reports a failed key", async () => {
    bucket.put("a", "image/jpeg", 1);
    bucket.deleteErrors.add("a");
    await expect(deleteKeys(["a"])).rejects.toThrow(/failed for 1 object/);
  });

  it("deleteKeys also deletes each key's staged upload, at most 1000 keys per request", async () => {
    const keys = Array.from({ length: 501 }, (_, i) => `k${i}`);
    for (const k of keys) {
      bucket.put(k, "image/jpeg", 1);
      bucket.put(`pending/${k}`, "image/jpeg", 1);
    }
    await deleteKeys(keys);
    expect(
      bucket.sent.filter((s) => s === "DeleteObjectsCommand"),
    ).toHaveLength(2);
    expect(bucket.keys()).toEqual([]);
  });

  it("deletePrefix of an empty prefix deletes nothing", async () => {
    expect(await deletePrefix("progress/nobody/")).toBe(0);
    expect(bucket.sent).toEqual(["ListObjectsV2Command"]);
  });

  it("deletePrefix pages through the listing", async () => {
    bucket.pageSize = 2;
    for (const k of ["p/1", "p/2", "p/3", "p/4", "p/5", "q/1"]) {
      bucket.put(k, "image/jpeg", 1);
    }
    expect(await deletePrefix("p/")).toBe(5);
    expect(bucket.keys()).toEqual(["q/1"]);
  });

  it("deleteAllUserMedia removes every object under the user's prefixes and nobody else's", async () => {
    bucket.pageSize = 2;
    const keep = [
      "progress/u2/s/front.jpg",
      "forms/u2/m.jpg",
      "resources/u2/m/file.pdf",
    ];
    for (const k of [
      "progress/u1/s1/front.jpg",
      "progress/u1/s1/side.jpg",
      "progress/u1/s2/back.jpg",
      "forms/u1/m1.jpg",
      "resources/u1/m2/file.pdf",
      ...keep,
    ]) {
      bucket.put(k, "image/jpeg", 1);
    }
    bucket.put("pending/progress/u1/s3/front.jpg", "image/jpeg", 1);
    expect(userPrefixes("u1")).toEqual([
      "progress/u1/",
      "forms/u1/",
      "resources/u1/",
      "pending/progress/u1/",
      "pending/forms/u1/",
      "pending/resources/u1/",
    ]);
    expect(await deleteAllUserMedia("u1")).toBe(6);
    expect(bucket.keys()).toEqual([...keep].sort());
  });
});

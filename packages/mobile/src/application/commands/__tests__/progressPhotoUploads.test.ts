import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type {
  PendingProgressPhoto,
  PendingProgressPhotoSet,
} from "@/domain/models/progressPhotos";
import type { ApiError } from "@/shared/errors/result";
import {
  deleteProgressPhotoSetCommand,
  savePendingProgressPhotosCommand,
} from "../progressPhotos.command";
import { processProgressPhotoUploads } from "../sync.command";

/**
 * PER-137: the offline upload queue — sets kept on the phone go
 * create → three uploads → complete, with retries and back-off.
 */

const USER = "athlete-1";
const T0 = Date.parse("2026-11-25T10:00:00.000Z");

const offline: ApiError = {
  kind: "api",
  code: "network",
  message: "Network request failed",
};
const status = (code: number, message = `HTTP ${code}`): ApiError => ({
  kind: "api",
  code: "server",
  status: code,
  message,
});

function photo(pose: PendingProgressPhoto["pose"]): PendingProgressPhoto {
  return {
    pose,
    uri: `file:///cache/${pose}.jpg`,
    bytes: 4,
    width: 1536,
    height: 2048,
  };
}

function setup() {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  let now = T0;
  const readFile = jest.fn(async (_uri: string) => new Blob(["jpeg"]));
  const run = () =>
    processProgressPhotoUploads(storage, api, USER, {
      readFile,
      now: () => now,
    });
  const save = () =>
    savePendingProgressPhotosCommand(
      storage,
      USER,
      {
        takenOn: "2026-11-25",
        photos: [photo("front"), photo("side"), photo("back")],
      },
      new Date(now),
    );
  const row = (id: string) => storage.getPendingProgressPhotoSet(id);
  return {
    api,
    storage,
    readFile,
    run,
    save,
    row,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("processProgressPhotoUploads", () => {
  it("uploads a saved set: create, three PUTs, complete, then into the gallery", async () => {
    const t = setup();
    const saved = t.save();
    await expect(t.run()).resolves.toEqual({
      uploaded: 1,
      retrying: 0,
      failed: 0,
    });
    expect(t.api.progressPhotoCalls).toEqual([
      `create:${saved.clientRequestId}`,
      "upload:front:4",
      "upload:side:4",
      "upload:back:4",
      "complete:set-1",
    ]);
    expect(t.row(saved.id)).toBeNull();
    const cache = t.storage.getCachedProgressPhotos(USER)!;
    expect(cache.sets.map((s) => [s.id, s.status])).toEqual([
      ["set-1", "ready"],
    ]);
  });

  it("keeps the set offline and retries with back-off, never giving up", async () => {
    const t = setup();
    const saved = t.save();
    t.api.progressPhotoFailures.create.push(offline, offline);

    await expect(t.run()).resolves.toMatchObject({ retrying: 1 });
    let row = t.row(saved.id)!;
    expect(row.attempts).toBe(1);
    expect(row.failed).toBeNull();
    expect(row.lastError).toBe("Network request failed");
    expect(row.nextAttemptAt).toBe(new Date(T0 + 5_000).toISOString());

    // Not due yet: nothing is sent.
    await t.run();
    expect(t.api.progressPhotoCalls).toHaveLength(1);

    t.advance(5_000);
    await t.run();
    row = t.row(saved.id)!;
    expect(row.attempts).toBe(2);
    expect(row.nextAttemptAt).toBe(new Date(T0 + 5_000 + 30_000).toISOString());

    t.advance(30_000);
    await expect(t.run()).resolves.toMatchObject({ uploaded: 1 });
    // Every try used the same Idempotency-Key.
    expect(
      t.api.progressPhotoCalls.filter((c) => c.startsWith("create:")),
    ).toEqual(Array(3).fill(`create:${saved.clientRequestId}`));
    expect(t.api.progressPhotoSets).toHaveLength(1);
  });

  it("a failed upload retries; the retried create returns the same set with links for what's left", async () => {
    const t = setup();
    const saved = t.save();
    // front uploads, side fails (e.g. an expired link → 403).
    const upload = t.api.uploadProgressPhoto.bind(t.api);
    let calls = 0;
    jest.spyOn(t.api, "uploadProgressPhoto").mockImplementation((u, b) => {
      calls++;
      if (calls === 2)
        return Promise.resolve({ ok: false, error: status(403) });
      return upload(u, b);
    });

    await expect(t.run()).resolves.toMatchObject({ retrying: 1 });
    expect(t.row(saved.id)?.serverSetId).toBe("set-1");

    t.advance(5_000);
    await expect(t.run()).resolves.toMatchObject({ uploaded: 1 });
    expect(t.api.progressPhotoSets).toHaveLength(1);
    // The second pass only re-sent the poses not yet stored.
    expect(t.api.progressPhotoCalls.slice(-4)).toEqual([
      `create:${saved.clientRequestId}`,
      "upload:side:4",
      "upload:back:4",
      "complete:set-1",
    ]);
  });

  it("retries an incomplete complete (422) and a 5xx", async () => {
    const t = setup();
    const saved = t.save();
    t.api.progressPhotoFailures.complete.push(status(422), status(503));
    await t.run();
    expect(t.row(saved.id)?.attempts).toBe(1);
    t.advance(5_000);
    await t.run();
    expect(t.row(saved.id)?.attempts).toBe(2);
    t.advance(30_000);
    await expect(t.run()).resolves.toMatchObject({ uploaded: 1 });
  });

  it("stops on a set the server refuses for good", async () => {
    const t = setup();
    const saved = t.save();
    t.api.progressPhotoFailures.create.push(
      status(422, "Add a front, side and back photo"),
    );
    await expect(t.run()).resolves.toMatchObject({ failed: 1 });
    const row = t.row(saved.id)!;
    expect(row.failed).toBe("rejected");
    expect(row.lastError).toBe("Add a front, side and back photo");
    t.advance(10_000_000);
    await t.run();
    expect(t.api.progressPhotoCalls).toHaveLength(1);
  });

  it("stops when complete is refused for good", async () => {
    const t = setup();
    const saved = t.save();
    t.api.progressPhotoFailures.complete.push(status(400));
    await t.run();
    expect(t.row(saved.id)?.failed).toBe("rejected");
  });

  it("retries a 401 or 403 from create and complete (an expired session isn't a refusal)", async () => {
    const t = setup();
    const saved = t.save();
    t.api.progressPhotoFailures.create.push(status(401), status(403));
    t.api.progressPhotoFailures.complete.push(status(401), status(403));
    for (const wait of [0, 5_000, 30_000, 120_000]) {
      t.advance(wait);
      await expect(t.run()).resolves.toMatchObject({ retrying: 1 });
      expect(t.row(saved.id)?.failed).toBeNull();
    }
    expect(t.row(saved.id)?.attempts).toBe(4);
    t.advance(600_000);
    await expect(t.run()).resolves.toMatchObject({ uploaded: 1 });
  });

  it("a delete by the phone id after the set uploaded deletes the server copy", async () => {
    const t = setup();
    const saved = t.save();
    await t.run();
    expect(t.storage.getCachedProgressPhotos(USER)?.sets).toHaveLength(1);
    // The viewer's confirm still holds the phone id.
    deleteProgressPhotoSetCommand(t.storage, USER, saved.id);
    expect(t.storage.getCachedProgressPhotos(USER)?.sets).toEqual([]);
    expect(t.storage.getPendingMutations()[0]).toMatchObject({
      entityId: "set-1",
      method: "DELETE",
      endpoint: "/users/me/progress-photos/set-1",
    });
  });

  it("retries a 429 and a 408", async () => {
    const t = setup();
    const saved = t.save();
    t.api.progressPhotoFailures.create.push(status(429), status(408));
    await t.run();
    t.advance(5_000);
    await t.run();
    expect(t.row(saved.id)?.failed).toBeNull();
    expect(t.row(saved.id)?.attempts).toBe(2);
  });

  it("marks a set whose photo file is gone and sends nothing", async () => {
    const t = setup();
    const saved = t.save();
    t.readFile.mockRejectedValueOnce(new Error("No such file"));
    await expect(t.run()).resolves.toMatchObject({ failed: 1 });
    expect(t.row(saved.id)).toMatchObject({
      failed: "file_missing",
      lastError: "No such file",
    });
    expect(t.api.progressPhotoCalls).toEqual([]);
  });

  it("names a missing file even when the reader throws a non-Error", async () => {
    const t = setup();
    const saved = t.save();
    t.readFile.mockRejectedValueOnce("gone");
    await t.run();
    expect(t.row(saved.id)?.lastError).toBe("Photo file missing");
  });

  it("drops the set when the server says it was deleted (409) or is gone (404)", async () => {
    const t = setup();
    const a = t.save();
    t.api.progressPhotoFailures.create.push(status(409));
    await t.run();
    expect(t.row(a.id)).toBeNull();

    const b = t.save();
    t.api.progressPhotoFailures.complete.push(status(404));
    await t.run();
    expect(t.row(b.id)).toBeNull();
    expect(t.storage.getCachedProgressPhotos(USER)).toBeNull();
  });

  it("deletes the server copy when the athlete deletes the set mid-create", async () => {
    const t = setup();
    const saved = t.save();
    const create = t.api.createProgressPhotoSet.bind(t.api);
    jest
      .spyOn(t.api, "createProgressPhotoSet")
      .mockImplementation(async (input, key) => {
        deleteProgressPhotoSetCommand(t.storage, USER, saved.id);
        return create(input, key);
      });
    await t.run();
    expect(t.api.progressPhotoCalls).toEqual([
      `create:${saved.clientRequestId}`,
    ]);
    expect(t.storage.getPendingMutations()[0]).toMatchObject({
      entityId: "set-1",
      method: "DELETE",
    });
  });

  it("doesn't show a set deleted during its uploads; its delete is queued", async () => {
    const t = setup();
    const saved = t.save();
    const complete = t.api.completeProgressPhotoSet.bind(t.api);
    jest
      .spyOn(t.api, "completeProgressPhotoSet")
      .mockImplementation(async (id) => {
        deleteProgressPhotoSetCommand(t.storage, USER, saved.id);
        return complete(id);
      });
    await t.run();
    expect(t.storage.getCachedProgressPhotos(USER)?.sets ?? []).toEqual([]);
    expect(t.storage.getPendingMutations()[0]).toMatchObject({
      entityId: "set-1",
      method: "DELETE",
    });
  });

  it("stops quietly when the set is deleted while an upload fails or create fails", async () => {
    const t = setup();
    const saved = t.save();
    jest.spyOn(t.api, "uploadProgressPhoto").mockImplementation(async () => {
      deleteProgressPhotoSetCommand(t.storage, USER, saved.id);
      return { ok: false, error: offline };
    });
    await expect(t.run()).resolves.toEqual({
      uploaded: 0,
      retrying: 0,
      failed: 0,
    });

    const t2 = setup();
    const s2 = t2.save();
    jest
      .spyOn(t2.api, "createProgressPhotoSet")
      .mockImplementation(async () => {
        deleteProgressPhotoSetCommand(t2.storage, USER, s2.id);
        return { ok: false, error: offline };
      });
    await t2.run();
    expect(t2.storage.getPendingMutations()).toHaveLength(0);

    const t3 = setup();
    const s3 = t3.save();
    jest
      .spyOn(t3.api, "completeProgressPhotoSet")
      .mockImplementation(async () => {
        t3.storage.deletePendingProgressPhotoSet(s3.id);
        return { ok: false, error: offline };
      });
    await t3.run();
    expect(t3.row(s3.id)).toBeNull();
  });

  it("retries later when our own code throws", async () => {
    const t = setup();
    const saved = t.save();
    jest
      .spyOn(t.api, "createProgressPhotoSet")
      .mockRejectedValueOnce(new Error("boom"));
    await expect(t.run()).resolves.toMatchObject({ retrying: 1 });
    expect(t.row(saved.id)).toMatchObject({ attempts: 1, lastError: "boom" });

    const t2 = setup();
    const s2 = t2.save();
    jest.spyOn(t2.api, "createProgressPhotoSet").mockImplementationOnce(() => {
      t2.storage.deletePendingProgressPhotoSet(s2.id);
      return Promise.reject("not an Error");
    });
    await expect(t2.run()).resolves.toMatchObject({ retrying: 1 });
  });

  it("names a non-Error throw as an upload failure", async () => {
    const t = setup();
    const saved = t.save();
    jest.spyOn(t.api, "createProgressPhotoSet").mockRejectedValueOnce("weird");
    await t.run();
    expect(t.row(saved.id)?.lastError).toBe("Upload failed");
  });

  it("runs one pass at a time; a second caller shares it", async () => {
    const t = setup();
    t.save();
    const first = t.run();
    const second = t.run();
    expect(second).toBe(first);
    await first;
    expect(
      t.api.progressPhotoCalls.filter((c) => c.startsWith("create:")),
    ).toHaveLength(1);
  });

  it("uploads several sets oldest first and skips other users' sets", async () => {
    const t = setup();
    const a = t.save();
    t.advance(1_000);
    const b = t.save();
    const other: PendingProgressPhotoSet = {
      ...a,
      id: "local-other",
      userId: "someone-else",
    };
    t.storage.savePendingProgressPhotoSet(other);
    await expect(t.run()).resolves.toMatchObject({ uploaded: 2 });
    expect(
      t.api.progressPhotoCalls.filter((c) => c.startsWith("create:")),
    ).toEqual([`create:${a.clientRequestId}`, `create:${b.clientRequestId}`]);
    expect(t.storage.getPendingProgressPhotoSet("local-other")).not.toBeNull();
  });

  it("skips an upload link for a pose it has no file for", async () => {
    const t = setup();
    const saved = t.save();
    t.storage.savePendingProgressPhotoSet({
      ...saved,
      photos: saved.photos.filter((p) => p.pose !== "back"),
    });
    const create = t.api.createProgressPhotoSet.bind(t.api);
    jest
      .spyOn(t.api, "createProgressPhotoSet")
      .mockImplementation((input, key) =>
        create(
          { ...input, poses: [...input.poses, { pose: "back", bytes: 4 }] },
          key,
        ),
      );
    await t.run();
    expect(t.api.progressPhotoCalls).not.toContain("upload:back:4");
    // The server still waits for the back photo.
    expect(t.row(saved.id)?.attempts).toBe(1);
  });
});

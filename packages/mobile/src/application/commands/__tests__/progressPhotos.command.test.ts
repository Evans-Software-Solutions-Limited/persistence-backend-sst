import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type {
  PendingProgressPhoto,
  ProgressPhotoSet,
} from "@/domain/models/progressPhotos";
import { EMPTY_PROGRESS_PHOTOS } from "@/domain/services/progressPhotos.service";
import {
  declinePhotoSharingCommand,
  deleteProgressPhotoSetCommand,
  deletingProgressPhotoSetIds,
  grantPhotoSharingCommand,
  isLocalPhotoSetId,
  PHOTO_SHARING_ENDPOINT,
  PHOTO_SHARING_ENTITY,
  PROGRESS_PHOTO_SET_ENTITY,
  progressPhotosFromResponse,
  reconcileProgressPhotosRead,
  savePendingProgressPhotosCommand,
} from "../progressPhotos.command";

const USER = "athlete-1";
const NOW = new Date("2026-11-25T10:00:00.000Z");

function photo(pose: PendingProgressPhoto["pose"]): PendingProgressPhoto {
  return {
    pose,
    uri: `file:///cache/${pose}.jpg`,
    bytes: 1000,
    width: 1536,
    height: 2048,
  };
}
const THREE = [photo("front"), photo("side"), photo("back")];

function serverSet(id: string): ProgressPhotoSet {
  return {
    id,
    takenOn: "2026-11-20",
    source: "self",
    status: "ready",
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-20T09:00:00.000Z",
    photos: [],
    weight: null,
    bodyFat: null,
  };
}

const sharing = {
  needsPrompt: true,
  coaches: [{ trainerId: "t1", name: "Ana", sharing: false }],
  consentVersion: "v0",
  copy: "Share?",
};

describe("savePendingProgressPhotosCommand", () => {
  it("keeps the set on the phone, due now, with its own request id", () => {
    const storage = new InMemoryStorageAdapter();
    const row = savePendingProgressPhotosCommand(
      storage,
      USER,
      { takenOn: "2026-11-25", photos: THREE },
      NOW,
    );
    expect(isLocalPhotoSetId(row.id)).toBe(true);
    expect(row.id).toBe(`local-${row.clientRequestId}`);
    expect(row.nextAttemptAt).toBe(NOW.toISOString());
    expect(row.serverSetId).toBeNull();
    expect(storage.getPendingProgressPhotoSets(USER)).toEqual([row]);
    // Nothing goes on the JSON queue: files have their own step.
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("refuses a set without all three poses", () => {
    const storage = new InMemoryStorageAdapter();
    expect(() =>
      savePendingProgressPhotosCommand(storage, USER, {
        takenOn: "2026-11-25",
        photos: [photo("front"), photo("front"), photo("back")],
      }),
    ).toThrow("front, side and back");
    expect(() =>
      savePendingProgressPhotosCommand(storage, USER, {
        takenOn: "2026-11-25",
        photos: [photo("front")],
      }),
    ).toThrow();
    expect(storage.getPendingProgressPhotoSets(USER)).toEqual([]);
  });
});

describe("deleteProgressPhotoSetCommand", () => {
  it("removes an uploaded set and queues one DELETE", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheProgressPhotos(USER, {
      ...EMPTY_PROGRESS_PHOTOS,
      sets: [serverSet("s1"), serverSet("s2")],
    });
    deleteProgressPhotoSetCommand(storage, USER, "s1");
    deleteProgressPhotoSetCommand(storage, USER, "s1");
    expect(
      storage.getCachedProgressPhotos(USER)?.sets.map((s) => s.id),
    ).toEqual(["s2"]);
    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      entityType: PROGRESS_PHOTO_SET_ENTITY,
      entityId: "s1",
      method: "DELETE",
      endpoint: "/users/me/progress-photos/s1",
    });
    expect(deletingProgressPhotoSetIds(storage)).toEqual(new Set(["s1"]));
  });

  it("drops a set still on the phone without touching the server", () => {
    const storage = new InMemoryStorageAdapter();
    const row = savePendingProgressPhotosCommand(storage, USER, {
      takenOn: "2026-11-25",
      photos: THREE,
    });
    deleteProgressPhotoSetCommand(storage, USER, row.id);
    expect(storage.getPendingProgressPhotoSets(USER)).toEqual([]);
    expect(storage.getPendingMutations()).toHaveLength(0);
    // A local id that's already gone is a no-op.
    deleteProgressPhotoSetCommand(storage, USER, "local-gone");
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("deletes the server copy of a phone set whose create already landed", () => {
    const storage = new InMemoryStorageAdapter();
    const row = savePendingProgressPhotosCommand(storage, USER, {
      takenOn: "2026-11-25",
      photos: THREE,
    });
    storage.savePendingProgressPhotoSet({ ...row, serverSetId: "s9" });
    deleteProgressPhotoSetCommand(storage, USER, row.id);
    expect(storage.getPendingProgressPhotoSets(USER)).toEqual([]);
    expect(storage.getPendingMutations()[0]).toMatchObject({
      entityId: "s9",
      method: "DELETE",
    });
  });

  it("ignores finished or dead DELETEs when listing sets being deleted", () => {
    const storage = new InMemoryStorageAdapter();
    deleteProgressPhotoSetCommand(storage, USER, "s1");
    const [entry] = storage.getPendingMutations();
    storage.markMutationPermanentlyFailed(entry!.id, "gone");
    expect(deletingProgressPhotoSetIds(storage).size).toBe(0);
  });
});

describe("photo sharing prompt", () => {
  it("Share grants once, offline, and marks coaches as sharing", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheProgressPhotos(USER, {
      ...EMPTY_PROGRESS_PHOTOS,
      photoSharing: sharing,
    });
    grantPhotoSharingCommand(storage, USER, ["t1"]);
    grantPhotoSharingCommand(storage, USER, ["t1"]);
    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      entityType: PHOTO_SHARING_ENTITY,
      endpoint: PHOTO_SHARING_ENDPOINT,
      method: "POST",
    });
    const cache = storage.getCachedProgressPhotos(USER)!;
    expect(cache.photoSharing?.needsPrompt).toBe(false);
    expect(cache.sharingPromptAnsweredFor).toEqual(["t1"]);
  });

  it("Not now only records the answer", () => {
    const storage = new InMemoryStorageAdapter();
    declinePhotoSharingCommand(storage, USER, ["t1"]);
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(
      storage.getCachedProgressPhotos(USER)?.sharingPromptAnsweredFor,
    ).toEqual(["t1"]);
  });
});

describe("reconcileProgressPhotosRead", () => {
  const response = {
    sets: [serverSet("s1"), serverSet("s2")],
    photoSharing: sharing,
    asOf: "2026-11-25T10:00:00.000Z",
  };

  it("keeps sets being deleted out and keeps prompt answers", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheProgressPhotos(USER, {
      ...EMPTY_PROGRESS_PHOTOS,
      sets: [serverSet("s1"), serverSet("s2")],
      sharingPromptAnsweredFor: ["t1"],
    });
    deleteProgressPhotoSetCommand(storage, USER, "s1");
    const value = reconcileProgressPhotosRead(
      storage,
      USER,
      progressPhotosFromResponse(response),
    );
    expect(value.sets.map((s) => s.id)).toEqual(["s2"]);
    expect(value.sharingPromptAnsweredFor).toEqual(["t1"]);
    expect(value.photoSharing?.needsPrompt).toBe(true);
  });

  it("keeps a queued Share until it syncs", () => {
    const storage = new InMemoryStorageAdapter();
    grantPhotoSharingCommand(storage, USER, ["t1"]);
    const value = reconcileProgressPhotosRead(
      storage,
      USER,
      progressPhotosFromResponse(response),
    );
    expect(value.photoSharing?.needsPrompt).toBe(false);
  });

  it("tolerates a value with no sharing status", () => {
    const storage = new InMemoryStorageAdapter();
    const value = reconcileProgressPhotosRead(storage, USER, {
      ...EMPTY_PROGRESS_PHOTOS,
      sets: [serverSet("s1")],
    });
    expect(value.sets).toHaveLength(1);
    expect(value.photoSharing?.needsPrompt).toBe(false);
  });
});

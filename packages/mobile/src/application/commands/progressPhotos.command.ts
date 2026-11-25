import type {
  PendingProgressPhoto,
  PendingProgressPhotoSet,
  ProgressPhotosCache,
  ProgressPhotosResponse,
} from "@/domain/models/progressPhotos";
import { PROGRESS_PHOTO_POSES } from "@/domain/models/progressPhotos";
import type { StoragePort } from "@/domain/ports/storage.port";
import { isAutoResolvableSyncEntry } from "@/domain/ports/sync.types";
import {
  mergeProgressPhotosResponse,
  withSharingAnswered,
  withoutSet,
} from "@/domain/services/progressPhotos.service";
import { newIdempotencyKey } from "@/shared/utils/idempotency";

/**
 * PER-137 (APP-F1): progress photo writes, offline-first.
 *
 * - **Saving** keeps the three JPEGs on the phone and lists the set in
 *   `pending_progress_photos`. `processProgressPhotoUploads` (sync.command)
 *   then runs create → three uploads → complete, with retries.
 * - **Deleting** an uploaded set removes it from the gallery cache and
 *   queues `DELETE /users/me/progress-photos/:id` on the JSON sync queue.
 *   A set still on the phone is just dropped (plus a DELETE if its create
 *   already reached the server).
 * - **The sharing prompt**'s "Share" queues
 *   `POST /users/me/progress-photos/sharing`; either answer is remembered
 *   on the phone so the athlete is asked once per coach.
 */

export const PROGRESS_PHOTO_SET_ENTITY = "progress_photo_set";
export const PHOTO_SHARING_ENTITY = "progress_photo_sharing";
export const PROGRESS_PHOTOS_ENDPOINT = "/users/me/progress-photos";
export const PHOTO_SHARING_ENDPOINT = "/users/me/progress-photos/sharing";
export const LOCAL_PHOTO_SET_PREFIX = "local-";

export function isLocalPhotoSetId(id: string): boolean {
  return id.startsWith(LOCAL_PHOTO_SET_PREFIX);
}

/** Server set ids with a DELETE still waiting in the sync queue. */
export function deletingProgressPhotoSetIds(storage: StoragePort): Set<string> {
  return new Set(
    storage
      .getUncompletedMutations()
      .filter(
        (e) =>
          e.entityType === PROGRESS_PHOTO_SET_ENTITY &&
          e.method === "DELETE" &&
          e.entityId !== null &&
          isAutoResolvableSyncEntry(e),
      )
      .map((e) => e.entityId!),
  );
}

/**
 * Keep a set taken on the phone until it uploads. Exactly one photo per
 * pose (Save only works once all three are taken, Y3b).
 */
export function savePendingProgressPhotosCommand(
  storage: StoragePort,
  userId: string,
  input: { takenOn: string; photos: readonly PendingProgressPhoto[] },
  now: Date = new Date(),
): PendingProgressPhotoSet {
  const poses = input.photos.map((p) => p.pose);
  if (
    poses.length !== PROGRESS_PHOTO_POSES.length ||
    PROGRESS_PHOTO_POSES.some((pose) => !poses.includes(pose))
  ) {
    throw new Error("A progress photo set needs a front, side and back photo");
  }
  const clientRequestId = newIdempotencyKey("progress-photos");
  const row: PendingProgressPhotoSet = {
    id: `${LOCAL_PHOTO_SET_PREFIX}${clientRequestId}`,
    userId,
    takenOn: input.takenOn,
    clientRequestId,
    photos: input.photos.map((p) => ({ ...p })),
    serverSetId: null,
    attempts: 0,
    nextAttemptAt: now.toISOString(),
    lastError: null,
    failed: null,
    createdAt: now.toISOString(),
  };
  storage.savePendingProgressPhotoSet(row);
  return row;
}

/** Queue the server delete once (DELETE is idempotent server-side too). */
export function enqueueProgressPhotoSetDelete(
  storage: StoragePort,
  setId: string,
): void {
  if (deletingProgressPhotoSetIds(storage).has(setId)) return;
  storage.enqueueMutation({
    entityType: PROGRESS_PHOTO_SET_ENTITY,
    entityId: setId,
    operation: "delete",
    payload: {},
    endpoint: `${PROGRESS_PHOTOS_ENDPOINT}/${encodeURIComponent(setId)}`,
    method: "DELETE",
  });
}

/**
 * Phone id → server id for sets this app session uploaded. The upload step
 * removes the `pending_progress_photos` row once a set completes, but a
 * screen opened before that (the viewer, a delete confirm) still holds the
 * phone id; this keeps it pointing at the uploaded set (Inspector Brad, #567).
 * Lives as long as the app process, which outlives any such screen.
 */
const uploadedPhotoSetIds = new Map<string, string>();

export function recordUploadedPhotoSet(
  localId: string,
  serverId: string,
): void {
  uploadedPhotoSetIds.set(localId, serverId);
}

/** The id to use for a set now: its server id once a phone set uploaded. */
export function resolvePhotoSetId(id: string): string {
  return uploadedPhotoSetIds.get(id) ?? id;
}

/** Delete a set from the gallery, offline-safe. */
export function deleteProgressPhotoSetCommand(
  storage: StoragePort,
  userId: string,
  setId: string,
): void {
  if (isLocalPhotoSetId(setId)) {
    const row = storage.getPendingProgressPhotoSet(setId);
    storage.deletePendingProgressPhotoSet(setId);
    // Uploaded while the confirm was open: delete the server copy.
    const serverId = row?.serverSetId ?? uploadedPhotoSetIds.get(setId);
    if (!serverId) return;
    setId = serverId;
  }
  storage.cacheProgressPhotos(
    userId,
    withoutSet(storage.getCachedProgressPhotos(userId), setId),
  );
  enqueueProgressPhotoSetDelete(storage, setId);
}

/** "Share": grant every active coach, now or when back online. */
export function grantPhotoSharingCommand(
  storage: StoragePort,
  userId: string,
  trainerIds: readonly string[],
): void {
  storage.cacheProgressPhotos(
    userId,
    withSharingAnswered(
      storage.getCachedProgressPhotos(userId),
      trainerIds,
      true,
    ),
  );
  const queued = storage
    .getUncompletedMutations()
    .some(
      (e) =>
        e.entityType === PHOTO_SHARING_ENTITY && isAutoResolvableSyncEntry(e),
    );
  if (queued) return;
  storage.enqueueMutation({
    entityType: PHOTO_SHARING_ENTITY,
    entityId: userId,
    operation: "create",
    payload: {},
    endpoint: PHOTO_SHARING_ENDPOINT,
    method: "POST",
  });
}

/** "Not now": don't ask again about these coaches on this phone. */
export function declinePhotoSharingCommand(
  storage: StoragePort,
  userId: string,
  trainerIds: readonly string[],
): void {
  storage.cacheProgressPhotos(
    userId,
    withSharingAnswered(
      storage.getCachedProgressPhotos(userId),
      trainerIds,
      false,
    ),
  );
}

/** Response → cache shape, before `reconcileProgressPhotosRead`. */
export function progressPhotosFromResponse(
  res: ProgressPhotosResponse,
): ProgressPhotosCache {
  return {
    sets: res.sets,
    photoSharing: res.photoSharing,
    asOf: res.asOf,
    sharingPromptAnsweredFor: [],
  };
}

/**
 * Adopt a read: drop sets with a queued delete, keep this phone's prompt
 * answers, and keep a queued "Share" (until it syncs the server still
 * says the coaches aren't sharing).
 */
export function reconcileProgressPhotosRead(
  storage: StoragePort,
  userId: string,
  value: ProgressPhotosCache,
): ProgressPhotosCache {
  const prev = storage.getCachedProgressPhotos(userId);
  const merged = mergeProgressPhotosResponse(
    prev,
    {
      sets: value.sets,
      photoSharing: value.photoSharing ?? {
        needsPrompt: false,
        coaches: [],
        consentVersion: "",
        copy: "",
      },
      asOf: value.asOf ?? "",
    },
    deletingProgressPhotoSetIds(storage),
  );
  const sharingQueued = storage
    .getUncompletedMutations()
    .some(
      (e) =>
        e.entityType === PHOTO_SHARING_ENTITY && isAutoResolvableSyncEntry(e),
    );
  return sharingQueued ? withSharingAnswered(merged, [], true) : merged;
}

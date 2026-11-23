import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";
import {
  bodyMeasurements,
  PROGRESS_PHOTO_POSES,
  progressPhotos,
  progressPhotoSets,
  type ProgressPhoto,
  type ProgressPhotoPose,
  type ProgressPhotoSet,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  checkUpload,
  deleteKeys,
  MAX_PHOTO_BYTES,
  presignUpload,
  presignView,
  type PresignedUpload,
} from "./privateMediaStore";

/**
 * Progress photo sets (PER-121, backend design F).
 *
 * Every function takes the owner's user id first and filters by it, so one
 * athlete can never read, complete or delete another's set. Coaches read
 * through `listSets` only after the handler's scope, switch and consent
 * checks (progressPhotosHandlers.ts).
 *
 * The image bytes never pass through the API: the phone PUTs each pose to the
 * private bucket with a presigned link, then calls complete.
 */

export const PHOTO_CONTENT_TYPE = "image/jpeg";
/** A measurement counts for a set within this many days of `taken_on`. */
export const MEASUREMENT_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PoseInput {
  pose: ProgressPhotoPose;
  bytes: number;
  width?: number | null;
  height?: number | null;
}

export interface PhotoDTO {
  id: string;
  pose: ProgressPhotoPose;
  bytes: number;
  width: number | null;
  height: number | null;
  /** Short-lived; never store it. Cache the image by photo id instead. */
  url: string;
  expiresAt: string;
}

export interface SetDTO {
  id: string;
  takenOn: string;
  source: string;
  status: "pending" | "ready";
  createdAt: string;
  updatedAt: string;
  photos: PhotoDTO[];
  /** Nearest weight within 7 days of `takenOn`, or null. */
  weight: { kg: number; measuredAt: string } | null;
  /** Nearest body fat within 7 days of `takenOn`, or null. */
  bodyFat: { percentage: number; measuredAt: string } | null;
}

export interface UploadDTO extends PresignedUpload {
  pose: ProgressPhotoPose;
}

const POSE_ORDER: Record<ProgressPhotoPose, number> = {
  front: 0,
  side: 1,
  back: 2,
};

export function photoKey(
  userId: string,
  setId: string,
  pose: ProgressPhotoPose,
): string {
  return `progress/${userId}/${setId}/${pose}.jpg`;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date, not before 1970 and not after tomorrow (UTC). */
export function validTakenOn(raw: string, now = new Date()): boolean {
  if (!DATE_PATTERN.test(raw)) return false;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  if (date.toISOString().slice(0, 10) !== raw) return false;
  if (raw < "1970-01-01") return false;
  const tomorrow = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
  return raw <= tomorrow;
}

export type PoseError = { at: string; message: string };

/** Exactly front, side and back, once each, each ≤ 10 MB. */
export function validatePoses(poses: PoseInput[]): PoseError[] {
  const errors: PoseError[] = [];
  const seen = new Set<string>();
  poses.forEach((p, i) => {
    if (!PROGRESS_PHOTO_POSES.includes(p.pose)) {
      errors.push({
        at: `poses.${i}.pose`,
        message: "must be front, side or back",
      });
      return;
    }
    if (seen.has(p.pose)) {
      errors.push({ at: `poses.${i}.pose`, message: "each pose only once" });
    }
    seen.add(p.pose);
    if (
      !Number.isInteger(p.bytes) ||
      p.bytes < 1 ||
      p.bytes > MAX_PHOTO_BYTES
    ) {
      errors.push({
        at: `poses.${i}.bytes`,
        message: `must be 1 to ${MAX_PHOTO_BYTES} bytes`,
      });
    }
  });
  for (const pose of PROGRESS_PHOTO_POSES) {
    if (!seen.has(pose))
      errors.push({ at: "poses", message: `${pose} is missing` });
  }
  return errors;
}

type Measurement = {
  measuredAt: Date;
  weightKg: string | null;
  bodyFatPercentage: string | null;
};

/** Noon UTC on the set's date: the point measurements are compared with. */
function anchor(takenOn: string): number {
  return new Date(`${takenOn}T12:00:00Z`).getTime();
}

/**
 * The measurement nearest `takenOn` that has a value for `pick`, within
 * 7 days either side, or null. A tie goes to the earlier measurement.
 */
export function nearestMeasurement<T>(
  takenOn: string,
  rows: Measurement[],
  pick: (m: Measurement) => T | null,
): { value: T; measuredAt: Date } | null {
  const at = anchor(takenOn);
  let best: { value: T; measuredAt: Date; distance: number } | null = null;
  for (const row of rows) {
    const value = pick(row);
    if (value === null) continue;
    const distance = Math.abs(row.measuredAt.getTime() - at);
    if (distance > MEASUREMENT_WINDOW_DAYS * DAY_MS + DAY_MS / 2) continue;
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && row.measuredAt < best.measuredAt)
    ) {
      best = { value, measuredAt: row.measuredAt, distance };
    }
  }
  return best ? { value: best.value, measuredAt: best.measuredAt } : null;
}

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function measurementsFor(
  userId: string,
  dates: string[],
): Promise<Measurement[]> {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const from = new Date(
    anchor(sorted[0]!) - (MEASUREMENT_WINDOW_DAYS + 1) * DAY_MS,
  );
  const to = new Date(
    anchor(sorted[sorted.length - 1]!) + (MEASUREMENT_WINDOW_DAYS + 1) * DAY_MS,
  );
  const rows = await getDb()
    .select({
      measuredAt: bodyMeasurements.measuredAt,
      weightKg: bodyMeasurements.weightKg,
      bodyFatPercentage: bodyMeasurements.bodyFatPercentage,
    })
    .from(bodyMeasurements)
    .where(
      and(
        eq(bodyMeasurements.userId, userId),
        gte(bodyMeasurements.measuredAt, from),
        lte(bodyMeasurements.measuredAt, to),
        or(
          isNotNull(bodyMeasurements.weightKg),
          isNotNull(bodyMeasurements.bodyFatPercentage),
        ),
      ),
    )
    .orderBy(asc(bodyMeasurements.measuredAt));
  return rows.filter((r): r is Measurement => r.measuredAt !== null);
}

async function photosFor(
  setIds: string[],
): Promise<Map<string, ProgressPhoto[]>> {
  // Every requested set gets an entry (sets always have their three rows
  // until they are deleted), so callers can read `map.get(id)!`.
  const map = new Map<string, ProgressPhoto[]>(setIds.map((id) => [id, []]));
  if (setIds.length === 0) return map;
  const rows = await getDb()
    .select()
    .from(progressPhotos)
    .where(inArray(progressPhotos.setId, setIds));
  for (const row of rows) map.get(row.setId)!.push(row);
  for (const list of map.values()) {
    list.sort((a, b) => POSE_ORDER[a.pose] - POSE_ORDER[b.pose]);
  }
  return map;
}

async function setDtos(
  userId: string,
  sets: ProgressPhotoSet[],
  viewSeconds: number,
  now: Date,
): Promise<SetDTO[]> {
  const photos = await photosFor(sets.map((s) => s.id));
  const measurements = await measurementsFor(
    userId,
    sets.map((s) => s.takenOn),
  );
  return Promise.all(
    sets.map(async (set) => {
      const weight = nearestMeasurement(set.takenOn, measurements, (m) =>
        toNumber(m.weightKg),
      );
      const bodyFat = nearestMeasurement(set.takenOn, measurements, (m) =>
        toNumber(m.bodyFatPercentage),
      );
      const list = set.status === "ready" ? photos.get(set.id)! : [];
      return {
        id: set.id,
        takenOn: set.takenOn,
        source: set.source,
        status: set.status as SetDTO["status"],
        createdAt: set.createdAt.toISOString(),
        updatedAt: set.updatedAt.toISOString(),
        photos: await Promise.all(
          list.map(async (p) => {
            const link = await presignView(p.s3Key, viewSeconds, now);
            return {
              id: p.id,
              pose: p.pose,
              bytes: p.bytes,
              width: p.width,
              height: p.height,
              url: link.url,
              expiresAt: link.expiresAt,
            };
          }),
        ),
        weight: weight
          ? { kg: weight.value, measuredAt: weight.measuredAt.toISOString() }
          : null,
        bodyFat: bodyFat
          ? {
              percentage: bodyFat.value,
              measuredAt: bodyFat.measuredAt.toISOString(),
            }
          : null,
      };
    }),
  );
}

async function uploadsFor(
  photos: ProgressPhoto[],
  now: Date,
): Promise<UploadDTO[]> {
  const pending = photos
    .filter((p) => p.status === "pending")
    .sort((a, b) => POSE_ORDER[a.pose] - POSE_ORDER[b.pose]);
  return Promise.all(
    pending.map(async (p) => ({
      pose: p.pose,
      ...(await presignUpload(p.s3Key, PHOTO_CONTENT_TYPE, p.bytes, now)),
    })),
  );
}

export type CreateResult =
  | { ok: true; replay: boolean; set: SetDTO; uploads: UploadDTO[] }
  | { ok: false; status: 409; code: "set_deleted" };

async function findOwnedSet(
  userId: string,
  setId: string,
): Promise<ProgressPhotoSet | null> {
  const rows = await getDb()
    .select()
    .from(progressPhotoSets)
    .where(
      and(
        eq(progressPhotoSets.id, setId),
        eq(progressPhotoSets.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function replayFor(
  userId: string,
  clientRequestId: string,
  viewSeconds: number,
  now: Date,
): Promise<CreateResult | null> {
  const rows = await getDb()
    .select()
    .from(progressPhotoSets)
    .where(
      and(
        eq(progressPhotoSets.userId, userId),
        eq(progressPhotoSets.clientRequestId, clientRequestId),
      ),
    )
    .limit(1);
  const set = rows[0];
  if (!set) return null;
  if (set.deletedAt) return { ok: false, status: 409, code: "set_deleted" };
  const photos = (await photosFor([set.id])).get(set.id)!;
  const [dto] = await setDtos(userId, [set], viewSeconds, now);
  return {
    ok: true,
    replay: true,
    set: dto!,
    uploads: await uploadsFor(photos, now),
  };
}

/**
 * `POST /users/me/progress-photos`. A retry with the same `Idempotency-Key`
 * returns the same set, with fresh upload links for the poses not yet
 * completed (so it is also how a phone gets new links after one expires).
 */
export async function createSet(
  userId: string,
  input: { takenOn: string; poses: PoseInput[] },
  clientRequestId: string | null,
  viewSeconds: number,
  now = new Date(),
): Promise<CreateResult> {
  if (clientRequestId) {
    const replay = await replayFor(userId, clientRequestId, viewSeconds, now);
    if (replay) return replay;
  }
  const inserted = await getDb().transaction(async (tx) => {
    const sets = await tx
      .insert(progressPhotoSets)
      .values({
        userId,
        takenOn: input.takenOn,
        source: "self",
        status: "pending",
        clientRequestId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    const set = sets[0];
    if (!set) return null; // A concurrent create with the same key won.
    await tx.insert(progressPhotos).values(
      input.poses.map((p) => ({
        setId: set.id,
        pose: p.pose,
        s3Key: photoKey(userId, set.id, p.pose),
        bytes: p.bytes,
        width: p.width ?? null,
        height: p.height ?? null,
        status: "pending",
        createdAt: now,
      })),
    );
    return set;
  });
  if (!inserted) {
    return (await replayFor(userId, clientRequestId!, viewSeconds, now))!;
  }
  const photos = (await photosFor([inserted.id])).get(inserted.id)!;
  const [dto] = await setDtos(userId, [inserted], viewSeconds, now);
  return {
    ok: true,
    replay: false,
    set: dto!,
    uploads: await uploadsFor(photos, now),
  };
}

export type CompleteResult =
  | { ok: true; set: SetDTO }
  | { ok: false; status: 404; code: "set_not_found" }
  | {
      ok: false;
      status: 422;
      code: "upload_incomplete";
      poses: { pose: ProgressPhotoPose; reason: string }[];
    };

/**
 * `POST /users/me/progress-photos/:setId/complete`: HeadObject every pose not
 * yet checked. All three good → the set is `ready`. A missing upload leaves
 * the pose pending (retry after uploading); a wrong type or size deletes the
 * object, so the phone re-uploads with a fresh link (retry the create).
 * Idempotent: a ready set is returned as it is.
 */
export async function completeSet(
  userId: string,
  setId: string,
  viewSeconds: number,
  now = new Date(),
): Promise<CompleteResult> {
  const set = await findOwnedSet(userId, setId);
  if (!set || set.deletedAt) {
    return { ok: false, status: 404, code: "set_not_found" };
  }
  if (set.status === "ready") {
    const [dto] = await setDtos(userId, [set], viewSeconds, now);
    return { ok: true, set: dto! };
  }
  const photos = (await photosFor([set.id])).get(set.id)!;
  const failures: { pose: ProgressPhotoPose; reason: string }[] = [];
  const checked: string[] = [];
  // Every set is created with exactly its three photo rows, in pose order.
  for (const photo of photos) {
    const pose = photo.pose;
    if (photo.status === "ready") continue;
    const result = await checkUpload(photo.s3Key, {
      contentTypes: [PHOTO_CONTENT_TYPE],
      maxBytes: MAX_PHOTO_BYTES,
      bytes: photo.bytes,
    });
    if (result.ok) {
      checked.push(photo.id);
      continue;
    }
    failures.push({ pose, reason: result.reason });
    if (result.reason !== "missing") await deleteKeys([photo.s3Key]);
  }
  const ready = await getDb().transaction(async (tx) => {
    if (checked.length > 0) {
      await tx
        .update(progressPhotos)
        .set({ status: "ready" })
        .where(
          and(
            eq(progressPhotos.setId, set.id),
            inArray(progressPhotos.id, checked),
          ),
        );
    }
    if (failures.length > 0) return null;
    // A delete racing this still wins: its tombstone keeps the set out of
    // every list whatever its status.
    const rows = await tx
      .update(progressPhotoSets)
      .set({ status: "ready", updatedAt: now })
      .where(
        and(
          eq(progressPhotoSets.id, set.id),
          eq(progressPhotoSets.userId, userId),
        ),
      )
      .returning();
    return rows[0]!;
  });
  if (!ready) {
    return {
      ok: false,
      status: 422,
      code: "upload_incomplete",
      poses: failures,
    };
  }
  const [dto] = await setDtos(userId, [ready], viewSeconds, now);
  return { ok: true, set: dto! };
}

export interface ListResult {
  sets: SetDTO[];
  deletedIds: string[];
}

/**
 * Ready sets for `userId`, newest date first, with view links lasting
 * `viewSeconds`. With `since`: only sets changed after it, plus the ids of
 * sets deleted after it.
 */
export async function listSets(
  userId: string,
  since: Date | undefined,
  viewSeconds: number,
  now = new Date(),
): Promise<ListResult> {
  const rows = await getDb()
    .select()
    .from(progressPhotoSets)
    .where(
      and(
        eq(progressPhotoSets.userId, userId),
        since ? gt(progressPhotoSets.updatedAt, since) : undefined,
        or(
          and(
            eq(progressPhotoSets.status, "ready"),
            isNull(progressPhotoSets.deletedAt),
          ),
          since ? isNotNull(progressPhotoSets.deletedAt) : undefined,
        ),
      ),
    )
    .orderBy(
      desc(progressPhotoSets.takenOn),
      desc(progressPhotoSets.createdAt),
    );
  const live = rows.filter((r) => !r.deletedAt);
  const deletedIds = rows.filter((r) => r.deletedAt).map((r) => r.id);
  return { sets: await setDtos(userId, live, viewSeconds, now), deletedIds };
}

/**
 * `DELETE /users/me/progress-photos/:setId`: delete the objects first (a
 * failure throws and the delete is retried), then the photo rows, and leave a
 * tombstone for offline galleries. Already gone → still ok (idempotent).
 */
export async function deleteSet(
  userId: string,
  setId: string,
  now = new Date(),
): Promise<void> {
  const set = await findOwnedSet(userId, setId);
  if (!set || set.deletedAt) return;
  const photos = (await photosFor([set.id])).get(set.id)!;
  await deleteKeys(
    PROGRESS_PHOTO_POSES.map((pose) => photoKey(userId, set.id, pose))
      .concat(photos.map((p) => p.s3Key))
      .filter((k, i, all) => all.indexOf(k) === i),
  );
  await getDb().transaction(async (tx) => {
    await tx.delete(progressPhotos).where(eq(progressPhotos.setId, set.id));
    await tx
      .update(progressPhotoSets)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(progressPhotoSets.id, set.id),
          eq(progressPhotoSets.userId, userId),
        ),
      );
  });
}

/** Sets never completed are removed after this long (objects and rows). */
export const STALE_PENDING_MS = 2 * DAY_MS;

/**
 * Nightly: remove sets that were created but never completed. Their objects
 * are deleted too (a pose that passed its check was re-tagged, so the bucket
 * lifecycle rule would keep it). Returns how many sets were removed.
 */
export async function purgeStalePendingSets(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_PENDING_MS);
  const stale = await getDb()
    .select({ id: progressPhotoSets.id, userId: progressPhotoSets.userId })
    .from(progressPhotoSets)
    .where(
      and(
        eq(progressPhotoSets.status, "pending"),
        lt(progressPhotoSets.createdAt, cutoff),
      ),
    )
    .limit(500);
  if (stale.length === 0) return 0;
  await deleteKeys(
    stale.flatMap((s) =>
      PROGRESS_PHOTO_POSES.map((pose) => photoKey(s.userId, s.id, pose)),
    ),
  );
  await getDb()
    .delete(progressPhotoSets)
    .where(
      and(
        inArray(
          progressPhotoSets.id,
          stale.map((s) => s.id),
        ),
        eq(progressPhotoSets.status, "pending"),
      ),
    );
  return stale.length;
}

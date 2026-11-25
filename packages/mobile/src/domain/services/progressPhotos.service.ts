import type {
  PendingProgressPhotoSet,
  ProgressPhotoPose,
  ProgressPhotoSet,
  ProgressPhotosCache,
  ProgressPhotosResponse,
} from "@/domain/models/progressPhotos";

/**
 * PER-137 (APP-F1): pure rules for the progress photo gallery, the offline
 * upload step and the one-time photo-sharing prompt. No I/O.
 */

/**
 * Wait before the next upload attempt, by attempts already made. Offline
 * retries never give up (the phone has said nothing about the photos), they
 * just slow down to once an hour.
 */
export const UPLOAD_BACKOFF_MS: readonly number[] = [
  5_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000,
];

export function nextUploadDelayMs(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1), UPLOAD_BACKOFF_MS.length) - 1;
  return UPLOAD_BACKOFF_MS[i]!;
}

export const EMPTY_PROGRESS_PHOTOS: ProgressPhotosCache = {
  sets: [],
  photoSharing: null,
  asOf: null,
  sharingPromptAnsweredFor: [],
};

/** Newest date first; the later save first within a date. */
function byNewest(
  a: { takenOn: string; createdAt: string },
  b: { takenOn: string; createdAt: string },
): number {
  if (a.takenOn !== b.takenOn) return a.takenOn < b.takenOn ? 1 : -1;
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt < b.createdAt ? 1 : -1;
}

/**
 * Adopt a full `GET /users/me/progress-photos`. Sets this phone is still
 * deleting (a queued DELETE) stay out, so a read that lands before the
 * delete syncs can't bring them back. Cached sets updated after the read's
 * `asOf` stay in. The prompt answers recorded on this phone are kept.
 */
export function mergeProgressPhotosResponse(
  prev: ProgressPhotosCache | null,
  res: ProgressPhotosResponse,
  deletingIds: ReadonlySet<string>,
): ProgressPhotosCache {
  const fromServer = res.sets.filter(
    (s) => s.status === "ready" && !deletingIds.has(s.id),
  );
  // A set that finished uploading after this read began isn't in it yet:
  // keep it rather than wipe it until the next read (Inspector Brad, #567).
  const serverIds = new Set(res.sets.map((s) => s.id));
  const newerThanRead = res.asOf
    ? (prev?.sets ?? []).filter(
        (s) =>
          !serverIds.has(s.id) &&
          !deletingIds.has(s.id) &&
          (res.deletedIds ?? []).indexOf(s.id) === -1 &&
          Date.parse(s.updatedAt) > Date.parse(res.asOf),
      )
    : [];
  return {
    sets: [...fromServer, ...newerThanRead].sort(byNewest),
    photoSharing: res.photoSharing,
    asOf: res.asOf,
    sharingPromptAnsweredFor: prev?.sharingPromptAnsweredFor ?? [],
  };
}

/** Put a completed set into the cache (replacing one with the same id). */
export function withSet(
  cache: ProgressPhotosCache | null,
  set: ProgressPhotoSet,
): ProgressPhotosCache {
  const base = cache ?? EMPTY_PROGRESS_PHOTOS;
  return {
    ...base,
    sets: [...base.sets.filter((s) => s.id !== set.id), set].sort(byNewest),
  };
}

export function withoutSet(
  cache: ProgressPhotosCache | null,
  setId: string,
): ProgressPhotosCache {
  const base = cache ?? EMPTY_PROGRESS_PHOTOS;
  return { ...base, sets: base.sets.filter((s) => s.id !== setId) };
}

/**
 * The coaches the one-time "Share progress photos with your coaches" prompt
 * should ask about: active coaches without a grant this cycle, minus those
 * the athlete already answered for on this phone. Empty → don't ask.
 */
export function coachesToAskAboutSharing(
  cache: ProgressPhotosCache | null,
): string[] {
  if (!cache?.photoSharing?.needsPrompt) return [];
  const sharing = cache.photoSharing;
  const answered = new Set(cache.sharingPromptAnsweredFor);
  return sharing.coaches
    .filter((c) => !c.sharing && !answered.has(c.trainerId))
    .map((c) => c.trainerId);
}

export function withSharingAnswered(
  cache: ProgressPhotosCache | null,
  trainerIds: readonly string[],
  granted: boolean,
): ProgressPhotosCache {
  const base = cache ?? EMPTY_PROGRESS_PHOTOS;
  const answered = [
    ...new Set([...base.sharingPromptAnsweredFor, ...trainerIds]),
  ].sort();
  const photoSharing =
    granted && base.photoSharing
      ? {
          ...base.photoSharing,
          needsPrompt: false,
          coaches: base.photoSharing.coaches.map((c) => ({
            ...c,
            sharing: true,
          })),
        }
      : base.photoSharing;
  return { ...base, photoSharing, sharingPromptAnsweredFor: answered };
}

// ─── Gallery view ────────────────────────────────────────────────────────────

export type GalleryPhoto = {
  pose: ProgressPhotoPose;
  /** A view link, or the local file while the set waits to upload. */
  uri: string;
  /** Image cache key: the photo id (links expire), or the local file. */
  cacheKey: string;
};

export type GallerySet = {
  id: string;
  takenOn: string;
  createdAt: string;
  photos: GalleryPhoto[];
  weightKg: number | null;
  bodyFat: number | null;
  /** `uploading` while kept on the phone; `failed` when it stopped. */
  upload: "done" | "uploading" | "failed";
};

const POSE_INDEX: Record<ProgressPhotoPose, number> = {
  front: 0,
  side: 1,
  back: 2,
};

function byPose(
  a: { pose: ProgressPhotoPose },
  b: { pose: ProgressPhotoPose },
) {
  return POSE_INDEX[a.pose] - POSE_INDEX[b.pose];
}

/**
 * Every set to show: uploaded sets from the cache and sets still on the
 * phone, newest first. A phone set whose server copy is already cached
 * (complete landed, row not yet removed) shows once, as the server's.
 */
export function gallerySets(
  cache: ProgressPhotosCache | null,
  pending: readonly PendingProgressPhotoSet[],
): GallerySet[] {
  const server = cache?.sets ?? [];
  const serverIds = new Set(server.map((s) => s.id));
  const fromServer: GallerySet[] = server.map((s) => ({
    id: s.id,
    takenOn: s.takenOn,
    createdAt: s.createdAt,
    photos: [...s.photos]
      .sort(byPose)
      .map((p) => ({ pose: p.pose, uri: p.url, cacheKey: p.id })),
    weightKg: s.weight?.kg ?? null,
    bodyFat: s.bodyFat?.percentage ?? null,
    upload: "done",
  }));
  const fromPhone: GallerySet[] = pending
    .filter((p) => !(p.serverSetId && serverIds.has(p.serverSetId)))
    .map((p) => ({
      id: p.id,
      takenOn: p.takenOn,
      createdAt: p.createdAt,
      photos: [...p.photos]
        .sort(byPose)
        .map((f) => ({ pose: f.pose, uri: f.uri, cacheKey: f.uri })),
      weightKg: null,
      bodyFat: null,
      upload: p.failed ? "failed" : "uploading",
    }));
  return [...fromServer, ...fromPhone].sort(byNewest);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `2026-10-25` → "25 Oct" (with the year: "25 Oct 2026"). */
export function photoDateLabel(takenOn: string, withYear = false): string {
  const [y, m, d] = takenOn.split("-").map(Number);
  const label = `${d} ${MONTHS[(m ?? 1) - 1]}`;
  return withYear ? `${label} ${y}` : label;
}

/**
 * The viewer's "vs latest": this set's weight minus the latest set's, or
 * null when either has no weight. The latest set itself reads "Latest".
 */
export function weightVsLatestKg(
  selected: GallerySet,
  latest: GallerySet,
): number | null {
  if (selected.weightKg == null || latest.weightKg == null) return null;
  return selected.weightKg - latest.weightKg;
}

/**
 * The newest weight within 7 days of `day` (the server's window for a
 * set's weight), for the Add photos "Weight that day" row.
 */
export function weightNear(
  points: readonly { date: string; weightKg: number | null }[],
  day: string,
): number | null {
  const anchor = Date.parse(`${day}T00:00:00Z`);
  let best: { kg: number; distance: number; date: string } | null = null;
  for (const p of points) {
    if (p.weightKg == null) continue;
    const at = Date.parse(`${p.date.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(at)) continue;
    const distance = Math.abs(at - anchor);
    if (distance > 7 * 86_400_000) continue;
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && p.date > best.date)
    ) {
      best = { kg: p.weightKg, distance, date: p.date };
    }
  }
  return best?.kg ?? null;
}

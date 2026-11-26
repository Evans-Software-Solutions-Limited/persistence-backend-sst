/**
 * PER-137 (APP-F1): progress photos, athlete side. Wire shapes follow
 * BE-F1 (PER-121, backend design F):
 *
 * - `GET  /users/me/progress-photos`               → ProgressPhotosResponse
 * - `POST /users/me/progress-photos` (Idempotency-Key) → CreatedProgressPhotoSet
 * - `POST /users/me/progress-photos/:setId/complete`  → ProgressPhotoSet
 * - `DELETE /users/me/progress-photos/:setId`         → 204
 * - `POST /users/me/progress-photos/sharing`          → PhotoSharingStatus
 *
 * Photo `url`s are short-lived (15 minutes for the athlete) and never
 * stored as the image's identity: images are cached by photo id.
 */

export type ProgressPhotoPose = "front" | "side" | "back";

export const PROGRESS_PHOTO_POSES: readonly ProgressPhotoPose[] = [
  "front",
  "side",
  "back",
];

export type ProgressPhoto = {
  id: string;
  pose: ProgressPhotoPose;
  bytes: number;
  width: number | null;
  height: number | null;
  url: string;
  expiresAt: string;
};

export type ProgressPhotoSet = {
  id: string;
  /** YYYY-MM-DD */
  takenOn: string;
  source: string;
  status: "pending" | "ready";
  createdAt: string;
  updatedAt: string;
  photos: ProgressPhoto[];
  weight: { kg: number; measuredAt: string } | null;
  bodyFat: { percentage: number; measuredAt: string } | null;
};

export type PhotoSharingCoach = {
  trainerId: string;
  name: string | null;
  sharing: boolean;
};

export type PhotoSharingStatus = {
  /** True while any active coach doesn't hold a grant for this cycle. */
  needsPrompt: boolean;
  coaches: PhotoSharingCoach[];
  consentVersion: string;
  /** The prompt's wording, served by the backend (Brad writes it). */
  copy: string;
};

export type ProgressPhotosResponse = {
  sets: ProgressPhotoSet[];
  deletedIds?: string[];
  photoSharing: PhotoSharingStatus;
  asOf: string;
};

export type ProgressPhotoUpload = {
  pose: ProgressPhotoPose;
  url: string;
  method: "PUT";
  /** Send exactly these headers with the PUT (type and size are signed). */
  headers: Record<string, string>;
  expiresAt: string;
};

export type CreatedProgressPhotoSet = {
  set: ProgressPhotoSet;
  /** Links for the poses not uploaded yet (empty once all are done). */
  uploads: ProgressPhotoUpload[];
};

export type CreateProgressPhotoSetInput = {
  takenOn: string;
  poses: {
    pose: ProgressPhotoPose;
    bytes: number;
    width?: number | null;
    height?: number | null;
  }[];
};

/** The gallery cache (`cached_progress_photos`, one row per user). */
export type ProgressPhotosCache = {
  sets: ProgressPhotoSet[];
  photoSharing: PhotoSharingStatus | null;
  asOf: string | null;
  /**
   * Coaches the athlete has already answered the one-time sharing prompt
   * for on this phone (either answer), so "Not now" isn't asked again until
   * a new coach joins. Kept across server reads.
   */
  sharingPromptAnsweredFor: string[];
};

/** One photo kept on the phone until its set uploads. */
export type PendingProgressPhoto = {
  pose: ProgressPhotoPose;
  /** Local JPEG (≤ 2048 px long edge). */
  uri: string;
  bytes: number;
  width: number | null;
  height: number | null;
};

/**
 * A set saved on the phone and not yet uploaded (`pending_progress_photos`).
 * The upload step runs create → three PUTs → complete, separately from the
 * JSON sync queue, with retries and back-off.
 */
export type PendingProgressPhotoSet = {
  /** `local-<clientRequestId>`, the gallery's id until it uploads. */
  id: string;
  userId: string;
  takenOn: string;
  /** Sent as the create's `Idempotency-Key`: a retry returns the same set. */
  clientRequestId: string;
  photos: PendingProgressPhoto[];
  /** The server's set id once the create has answered. */
  serverSetId: string | null;
  attempts: number;
  /** ISO time before which the upload step leaves this set alone. */
  nextAttemptAt: string;
  lastError: string | null;
  /**
   * Set when the server refused the set for good, or a photo file is gone
   * from the phone. The upload step stops; the athlete can delete the set.
   */
  failed: "rejected" | "file_missing" | null;
  createdAt: string;
};

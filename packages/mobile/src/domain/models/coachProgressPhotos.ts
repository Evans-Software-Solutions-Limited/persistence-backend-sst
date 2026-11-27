import type { ApiError } from "@/shared/errors";
import type { ProgressPhotoSet } from "@/domain/models/progressPhotos";

/**
 * PER-138 (APP-F2): a client's progress photos, coach side (C3.4). Wire
 * shape of `GET /trainers/me/clients/:clientId/progress-photos` (BE-F1,
 * PER-121): the same sets the athlete sees, with view links that last 5
 * minutes for coaches. Images are cached by photo id, never by the link.
 */
export type CoachProgressPhotos = {
  sets: ProgressPhotoSet[];
  asOf: string;
};

/** Why the server won't show this coach the photos (its 403 codes). */
export type CoachPhotosDenial = "photos_off" | "not_shared" | "ended";

/** A failed read; `denial` is set when the server refused access. */
export type CoachPhotosApiError = ApiError & {
  readonly denial?: CoachPhotosDenial;
};

/** The gallery cache (`cached_coach_client_photos`, per coach and client). */
export type CoachClientPhotosCache = CoachProgressPhotos;

export type CompareMode = "side" | "wipe";

/**
 * PER-138 (C3.4): the coach's view of a client's progress photos. Wire shape
 * of `GET /trainers/me/clients/:clientId/progress-photos` (BE-F1, PER-121).
 * View links last 5 minutes for coaches and are never an image's identity:
 * images are cached by photo id.
 */

export type PhotoPose = "front" | "side" | "back";

export const POSES: readonly PhotoPose[] = ["front", "side", "back"];

export const POSE_LABEL: Record<PhotoPose, string> = {
  front: "Front",
  side: "Side",
  back: "Back",
};

export interface ClientPhoto {
  id: string;
  pose: PhotoPose;
  bytes: number;
  width: number | null;
  height: number | null;
  url: string;
  expiresAt: string;
}

export interface ClientPhotoSet {
  id: string;
  /** YYYY-MM-DD */
  takenOn: string;
  source: string;
  status: "pending" | "ready";
  createdAt: string;
  updatedAt: string;
  photos: ClientPhoto[];
  /** Nearest weight within 7 days of `takenOn`. */
  weight: { kg: number; measuredAt: string } | null;
  bodyFat: { percentage: number; measuredAt: string } | null;
}

export interface ClientPhotos {
  sets: ClientPhotoSet[];
  asOf: string;
}

/** Why the server won't show this coach the photos (403s). */
export type PhotosDenial = "photos_off" | "not_shared" | "ended";

export type CompareMode = "side" | "wipe";

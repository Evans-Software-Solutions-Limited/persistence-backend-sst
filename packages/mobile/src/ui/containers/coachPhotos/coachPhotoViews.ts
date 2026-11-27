import {
  PROGRESS_PHOTO_POSES,
  type ProgressPhoto,
  type ProgressPhotoPose,
  type ProgressPhotoSet,
} from "@/domain/models/progressPhotos";
import { photoForPose } from "@/domain/services/coachProgressPhotos.service";
import { photoDateLabel } from "@/domain/services/progressPhotos.service";
import type { ApiError } from "@/shared/errors";
import type { CoachClientPhotosState } from "@/ui/hooks/useCoachClientPhotos";
import type { CoachPhotoView } from "@/ui/presenters/coachPhotos/kit";
import type {
  ClientPhotosTabState,
  PhotoSetRowView,
  PhotosPose,
} from "@/ui/presenters/coachPhotos/ClientPhotosTabPresenter";

/** PER-138: view-model mapping shared by the Photos tab and compare. */

/** "Sam" from "Sam Patel"; a neutral word with no name yet. */
export function firstNameOf(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "Your client";
}

export const POSE_LABEL: Record<ProgressPhotoPose, PhotosPose> = {
  front: "Front",
  side: "Side",
  back: "Back",
};

export function poseKey(label: string | undefined): ProgressPhotoPose {
  switch (label?.toLowerCase()) {
    case "side":
      return "side";
    case "back":
      return "back";
    default:
      return "front";
  }
}

export function photoView(photo: ProgressPhoto | null): CoachPhotoView | null {
  return photo ? { id: photo.id, uri: photo.url } : null;
}

export function setRowView(set: ProgressPhotoSet): PhotoSetRowView {
  return {
    id: set.id,
    dateLabel: photoDateLabel(set.takenOn),
    photos: PROGRESS_PHOTO_POSES.map((pose) => ({
      pose: POSE_LABEL[pose],
      photo: photoView(photoForPose(set, pose)),
    })),
  };
}

function isConnectionError(error: ApiError): boolean {
  return error.code === "network" || error.code === "timeout";
}

/** Which state the tab (and compare) shows for this read. */
export function photosState(
  photos: Pick<CoachClientPhotosState, "denial" | "hasData" | "sets" | "error">,
  online: boolean,
): ClientPhotosTabState {
  if (photos.denial) return photos.denial;
  if (photos.hasData) return photos.sets.length > 0 ? "ready" : "empty";
  if (photos.error) {
    return !online || isConnectionError(photos.error)
      ? "offline_empty"
      : "error";
  }
  return "loading";
}

/** Showing the last read because this one couldn't reach the server. */
export function showingOffline(
  photos: Pick<CoachClientPhotosState, "hasData" | "error">,
  online: boolean,
): boolean {
  return (
    photos.hasData &&
    (!online || (photos.error !== null && isConnectionError(photos.error)))
  );
}

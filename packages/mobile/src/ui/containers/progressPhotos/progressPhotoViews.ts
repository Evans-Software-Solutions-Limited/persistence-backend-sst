import type { ProgressPhotoPose } from "@/domain/models/progressPhotos";
import {
  photoDateLabel,
  type GallerySet,
} from "@/domain/services/progressPhotos.service";
import { formatWeight, type WeightUnit } from "@/shared/utils";
import type {
  PhotoPoseLabel,
  PhotoTileView,
} from "@/ui/presenters/progressPhotos/PhotoTile";
import type { GallerySetView } from "@/ui/presenters/progressPhotos/ProgressPhotosGalleryPresenter";

/** PER-137: shared view-model mapping for Y1's gallery row, Y3 and Y3c. */

export const POSE_LABEL: Record<ProgressPhotoPose, PhotoPoseLabel> = {
  front: "Front",
  side: "Side",
  back: "Back",
};

export function poseFromLabel(label: string | undefined): ProgressPhotoPose {
  switch (label?.toLowerCase()) {
    case "side":
      return "side";
    case "back":
      return "back";
    default:
      return "front";
  }
}

/**
 * ⚠ Copy not on the canvas — Brad to confirm. Design F's fallback: with no
 * `expo-file-system` import, unsent photos live in the phone's temporary
 * storage, and the app warns they could be lost.
 */
export const PENDING_PHOTOS_WARNING =
  "Photos still uploading are kept in this phone's temporary storage and could be lost if the phone clears it.";
/** ⚠ Not on the canvas — shown in place of the weight while a set uploads. */
export const UPLOADING_LABEL = "Uploading";
/** ⚠ Not on the canvas — a set the upload step stopped on. */
export const UPLOAD_FAILED_LABEL = "Couldn't upload";

export function photoTiles(set: GallerySet): PhotoTileView[] {
  return set.photos.map((p) => ({
    pose: POSE_LABEL[p.pose],
    uri: p.uri,
    cacheKey: p.cacheKey,
  }));
}

export function weightLabel(kg: number | null, unit: WeightUnit): string {
  return kg == null ? "" : formatWeight(kg, unit);
}

export function gallerySetView(
  set: GallerySet,
  unit: WeightUnit,
): GallerySetView {
  return {
    id: set.id,
    dateLabel: photoDateLabel(set.takenOn),
    detail:
      set.upload === "uploading"
        ? UPLOADING_LABEL
        : set.upload === "failed"
          ? UPLOAD_FAILED_LABEL
          : weightLabel(set.weightKg, unit),
    photos: photoTiles(set),
  };
}

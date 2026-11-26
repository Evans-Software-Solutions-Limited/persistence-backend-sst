import { useCallback, useMemo } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useProgressPhotos } from "@/ui/hooks/useProgressPhotos";
import { ProgressPhotosGalleryPresenter } from "@/ui/presenters/progressPhotos/ProgressPhotosGalleryPresenter";
import type { PhotoPoseLabel } from "@/ui/presenters/progressPhotos/PhotoTile";
import { PENDING_PHOTOS_WARNING, gallerySetView } from "./progressPhotoViews";

/**
 * Y3 Gallery — `/(app)/progress-photos` (PER-137). Cache-first: renders the
 * cached sets and the sets still on the phone at once, offline, and
 * refreshes the view links on focus.
 */
export function ProgressPhotosGalleryContainer() {
  const router = useRouter();
  const photos = useProgressPhotos();
  const profile = useProfilePage();
  const unit = profile.payload?.profile.weightUnit ?? "kg";

  const sets = useMemo(
    () => photos.sets.map((s) => gallerySetView(s, unit)),
    [photos.sets, unit],
  );
  const hasUnsent = photos.sets.some((s) => s.upload !== "done");

  const reloadAll = photos.reloadAll;
  const refresh = photos.refresh;
  useFocusEffect(
    useCallback(() => {
      reloadAll();
      void refresh({ silent: true });
    }, [reloadAll, refresh]),
  );

  const onOpenPhoto = useCallback(
    (setId: string, pose: PhotoPoseLabel) =>
      router.push(
        `/(app)/progress-photo-viewer?setId=${encodeURIComponent(setId)}&pose=${pose.toLowerCase()}` as never,
      ),
    [router],
  );

  return (
    <ProgressPhotosGalleryPresenter
      sets={sets}
      pendingWarning={hasUnsent ? PENDING_PHOTOS_WARNING : null}
      isRefreshing={photos.isRefreshing}
      onRefresh={() => void refresh()}
      onBack={() => router.back()}
      onAdd={() => router.push("/(app)/progress-photos-add" as never)}
      onOpenPhoto={onOpenPhoto}
    />
  );
}

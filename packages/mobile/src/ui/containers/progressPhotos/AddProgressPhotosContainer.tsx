import { useCallback, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import {
  declinePhotoSharingCommand,
  grantPhotoSharingCommand,
  savePendingProgressPhotosCommand,
} from "@/application/commands/progressPhotos.command";
import {
  PROGRESS_PHOTO_POSES,
  type PendingProgressPhoto,
  type ProgressPhotoPose,
} from "@/domain/models/progressPhotos";
import {
  coachesToAskAboutSharing,
  photoDateLabel,
  weightNear,
} from "@/domain/services/progressPhotos.service";
import { localDayISO } from "@/shared/utils";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetBodyMeasurements } from "@/ui/hooks/useGetBodyMeasurements";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useProgressPhotoCapture } from "@/ui/hooks/useProgressPhotoCapture";
import { useProgressPhotos } from "@/ui/hooks/useProgressPhotos";
import { AddProgressPhotosPresenter } from "@/ui/presenters/progressPhotos/AddProgressPhotosPresenter";
import { POSE_LABEL, weightLabel } from "./progressPhotoViews";

/** The prompt's title: the ticket's name for it. */
export const PHOTO_SHARING_TITLE = "Share progress photos with your coaches";
/**
 * Mirrors `PHOTO_SHARING_COPY` (backend, approved by Brad on 26 Nov 2026).
 * The app shows the wording the backend serves; this is only used if a
 * cached status has none.
 */
export const PHOTO_SHARING_COPY_FALLBACK =
  "Share your progress photos with your coaches. Only your current coaches can see them, and they lose access when coaching ends.";

/**
 * Y3b Add photos — `/(app)/progress-photos-add` (PER-137). Each slot takes
 * one pose with the phone's camera or library; Save keeps the set on the
 * phone; the upload worker sends it once online. Athletes with a
 * coach who can't see their photos yet get the one-time sharing prompt.
 */
export function AddProgressPhotosContainer() {
  const router = useRouter();
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const { capture } = useProgressPhotoCapture();
  // Mounted so the sharing status is fresh for the prompt.
  useProgressPhotos();
  const body = useGetBodyMeasurements();
  const profile = useProfilePage();
  const unit = profile.payload?.profile.weightUnit ?? "kg";

  const [photos, setPhotos] = useState<
    Partial<Record<ProgressPhotoPose, PendingProgressPhoto>>
  >({});
  const [busy, setBusy] = useState<ProgressPhotoPose | null>(null);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  const today = useMemo(() => localDayISO(), []);
  const weightKg = useMemo(
    () => weightNear(body.data ?? [], today),
    [body.data, today],
  );

  const onTakePose = useCallback(
    async (pose: ProgressPhotoPose) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(pose);
      try {
        const photo = await capture(pose);
        if (photo) setPhotos((prev) => ({ ...prev, [pose]: photo }));
      } catch (err) {
        console.warn(
          "[AddProgressPhotos] capture failed:",
          err instanceof Error ? err.message : err,
        );
        Alert.alert(
          "Something went wrong",
          "We couldn't use that photo. Please try again.",
        );
      } finally {
        busyRef.current = false;
        setBusy(null);
      }
    },
    [capture],
  );

  const taken = PROGRESS_PHOTO_POSES.filter((p) => photos[p]).length;
  const canSave = taken === PROGRESS_PHOTO_POSES.length && userId !== null;

  const askToShare = useCallback(
    (uid: string) => {
      const cache = storage.getCachedProgressPhotos(uid);
      const trainerIds = coachesToAskAboutSharing(cache);
      if (trainerIds.length === 0) return;
      Alert.alert(
        PHOTO_SHARING_TITLE,
        cache?.photoSharing?.copy || PHOTO_SHARING_COPY_FALLBACK,
        [
          {
            text: "Not now",
            style: "cancel",
            onPress: () => declinePhotoSharingCommand(storage, uid, trainerIds),
          },
          {
            text: "Share",
            onPress: () => grantPhotoSharingCommand(storage, uid, trainerIds),
          },
        ],
        { cancelable: false },
      );
    },
    [storage],
  );

  const onSave = useCallback(() => {
    if (!canSave || saving || !userId) return;
    setSaving(true);
    try {
      savePendingProgressPhotosCommand(storage, userId, {
        takenOn: today,
        photos: PROGRESS_PHOTO_POSES.map((p) => photos[p]!),
      });
    } catch (err) {
      setSaving(false);
      console.warn("[AddProgressPhotos] save failed:", err);
      Alert.alert(
        "Something went wrong",
        "We couldn't save your photos. Please try again.",
      );
      return;
    }
    // The upload worker sees the new set and uploads it once online.
    router.back();
    askToShare(userId);
  }, [canSave, saving, userId, storage, today, photos, router, askToShare]);

  return (
    <AddProgressPhotosPresenter
      slots={PROGRESS_PHOTO_POSES.map((pose) => ({
        pose,
        label: POSE_LABEL[pose],
        photo: photos[pose] ? { uri: photos[pose].uri } : null,
        busy: busy === pose,
      }))}
      dateLabel={`Today, ${photoDateLabel(today)}`}
      weightLabel={weightLabel(weightKg, unit) || "—"}
      canSave={canSave}
      ctaLabel={
        taken === PROGRESS_PHOTO_POSES.length
          ? "Save photos"
          : `Add ${PROGRESS_PHOTO_POSES.length - taken} more to save`
      }
      isSaving={saving}
      onBack={() => router.back()}
      onTakePose={(pose) => void onTakePose(pose)}
      onSave={onSave}
    />
  );
}

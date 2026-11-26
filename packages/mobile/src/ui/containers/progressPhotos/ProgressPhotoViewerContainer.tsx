import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { lockLandscape, lockPortrait } from "@/lib/screenOrientation";
import {
  deleteProgressPhotoSetCommand,
  resolvePhotoSetId,
} from "@/application/commands/progressPhotos.command";
import type { ProgressPhotoPose } from "@/domain/models/progressPhotos";
import {
  photoDateLabel,
  weightVsLatestKg,
  type GallerySet,
} from "@/domain/services/progressPhotos.service";
import { weightInUnit, type WeightUnit } from "@/shared/utils";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useProgressPhotos } from "@/ui/hooks/useProgressPhotos";
import { ProgressPhotoViewerPresenter } from "@/ui/presenters/progressPhotos/ProgressPhotoViewerPresenter";
import { POSE_LABEL, poseFromLabel, weightLabel } from "./progressPhotoViews";

/** "−0.5 kg" / "+0.3 kg" / "0.0 kg" in the athlete's unit. */
export function signedWeight(deltaKg: number, unit: WeightUnit): string {
  const value = weightInUnit(Math.abs(deltaKg), unit);
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded === 0 ? "" : deltaKg < 0 ? "−" : "+";
  return `${sign}${rounded.toFixed(1)} ${unit}`;
}

export function viewerData(
  set: GallerySet,
  latest: GallerySet,
  unit: WeightUnit,
): { value: string; label: string }[] {
  const delta = weightVsLatestKg(set, latest);
  return [
    { value: weightLabel(set.weightKg, unit) || "—", label: "Weight" },
    {
      value: set.bodyFat == null ? "—" : `${set.bodyFat.toFixed(1)}%`,
      label: "Body fat",
    },
    {
      value:
        set.id === latest.id
          ? "Latest"
          : delta == null
            ? "—"
            : signedWeight(delta, unit),
      label: "vs latest",
    },
  ];
}

/**
 * Y3c photo viewer — `/(app)/progress-photo-viewer?setId=&pose=` (PER-137).
 * Landscape only, for this page (Brad, 26 Nov): it turns the screen
 * landscape while focused and back to portrait on blur or unmount (a no-op
 * on a 1.2.0 binary). One dropdown switches pose and date; delete removes
 * the whole set (offline-safe) after a confirm.
 */
export function ProgressPhotoViewerContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ setId?: string; pose?: string }>();
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const photos = useProgressPhotos();
  const profile = useProfilePage();
  const unit = profile.payload?.profile.weightUnit ?? "kg";

  const [setId, setSetId] = useState(params.setId ?? null);
  const [pose, setPose] = useState<ProgressPhotoPose>(
    poseFromLabel(params.pose),
  );
  const [open, setOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void lockLandscape();
      return () => {
        void lockPortrait();
      };
    }, []),
  );

  const sets = photos.sets;
  // A phone set that uploaded while open keeps showing under its server id.
  const currentId = setId ? resolvePhotoSetId(setId) : null;
  const set = sets.find((s) => s.id === currentId) ?? sets[0] ?? null;
  const latest = sets[0] ?? null;

  const reloadAll = photos.reloadAll;
  const onDelete = useCallback(() => {
    if (!set || !userId) return;
    Alert.alert(
      "Delete these photos?",
      `The front, side and back photos from ${photoDateLabel(set.takenOn)} will be deleted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteProgressPhotoSetCommand(storage, userId, set.id);
            const next = sets.find((s) => s.id !== set.id) ?? null;
            reloadAll();
            if (next) setSetId(next.id);
            else router.back();
          },
        },
      ],
    );
  }, [set, userId, storage, sets, reloadAll, router]);

  if (!set || !latest) {
    return (
      <ProgressPhotoViewerPresenter
        photo={null}
        pose={POSE_LABEL[pose]}
        dateLabel=""
        data={[]}
        accessibilityLabel="No photos"
        open={false}
        dates={[]}
        onClose={() => router.back()}
        onToggle={() => undefined}
        onSelectPose={() => undefined}
        onSelectDate={() => undefined}
        onAdd={() => router.push("/(app)/progress-photos-add" as never)}
        onDelete={() => undefined}
      />
    );
  }

  const photo = set.photos.find((p) => p.pose === pose) ?? set.photos[0];
  const dateLabel = photoDateLabel(set.takenOn, true);
  const weight = weightLabel(set.weightKg, unit);

  return (
    <ProgressPhotoViewerPresenter
      photo={photo ? { uri: photo.uri, cacheKey: photo.cacheKey } : null}
      pose={POSE_LABEL[pose]}
      dateLabel={dateLabel}
      data={viewerData(set, latest, unit)}
      accessibilityLabel={`${POSE_LABEL[pose]} photo, ${dateLabel}${weight ? `, ${weight}` : ""}`}
      open={open}
      dates={sets.map((s) => ({
        id: s.id,
        label: photoDateLabel(s.takenOn, true),
        weight: weightLabel(s.weightKg, unit),
        selected: s.id === set.id,
      }))}
      onClose={() => router.back()}
      onToggle={() => setOpen((o) => !o)}
      onSelectPose={(label) => setPose(poseFromLabel(label))}
      onSelectDate={(id) => {
        setSetId(id);
        setOpen(false);
      }}
      onAdd={() => router.push("/(app)/progress-photos-add" as never)}
      onDelete={onDelete}
    />
  );
}

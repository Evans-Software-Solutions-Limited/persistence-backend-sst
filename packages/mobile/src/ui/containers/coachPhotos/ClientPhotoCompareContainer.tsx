import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { CompareMode } from "@/domain/models/coachProgressPhotos";
import {
  compareStrip,
  orderedComparePair,
  photoForPose,
} from "@/domain/services/coachProgressPhotos.service";
import { photoDateLabel } from "@/domain/services/progressPhotos.service";
import { weightInUnit, type WeightUnit } from "@/shared/utils";
import { useCoachClientPhotos } from "@/ui/hooks/useCoachClientPhotos";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { PhotoComparePresenter } from "@/ui/presenters/coachPhotos/PhotoComparePresenter";
import {
  POSE_LABEL,
  firstNameOf,
  photoView,
  photosState,
  poseKey,
  showingOffline,
} from "./coachPhotoViews";

/**
 * C3.4c photo compare (PER-138), `/clients/[id]/photos-compare`. Opens on
 * the first and latest sets (or `setId` against the latest), front pose
 * unless `pose` says otherwise. Reads the photos again on open, so view
 * links are fresh; the server's refusal replaces anything shown.
 */
export function ClientPhotoCompareContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    name?: string;
    pose?: string;
    setId?: string;
  }>();
  const clientId = params.id ?? "";
  const online = useOnlineStatus();
  const weightUnit: WeightUnit =
    useProfilePage().payload?.profile.weightUnit ?? "kg";
  const photos = useCoachClientPhotos(clientId);
  const [pose, setPose] = useState(poseKey(params.pose));
  const [mode, setMode] = useState<CompareMode>("side");
  const [wipe, setWipe] = useState(0.5);
  const [picked, setPicked] = useState<[string, string] | null>(null);

  const sets = photos.sets;
  const latestId = sets[0]?.id ?? null;
  const pairIds: [string, string] | null =
    picked ??
    (params.setId && latestId && params.setId !== latestId
      ? [params.setId, latestId]
      : null);
  const pair = orderedComparePair(sets, pairIds);
  const baseState = photosState(photos, online);
  const state = baseState === "ready" && !pair ? "single" : baseState;
  const side = (s: (typeof sets)[number]) => ({
    id: s.id,
    dateLabel: photoDateLabel(s.takenOn),
    photo: photoView(photoForPose(s, pose)),
  });
  const strip = pair
    ? compareStrip(pair[0], pair[1], (kg) => weightInUnit(kg, weightUnit))
    : null;

  return (
    <PhotoComparePresenter
      state={state}
      clientName={params.name || "Client"}
      clientFirst={firstNameOf(params.name)}
      pose={POSE_LABEL[pose]}
      mode={mode}
      older={pair ? side(pair[0]) : null}
      newer={pair ? side(pair[1]) : null}
      dates={sets.map((s) => ({
        id: s.id,
        dateLabel: photoDateLabel(s.takenOn),
      }))}
      strip={strip ? { ...strip, weightUnit } : null}
      thumbs={sets.map((s) => ({
        ...side(s),
        selected: pair ? pair.some((x) => x.id === s.id) : false,
      }))}
      wipe={wipe}
      offline={showingOffline(photos, online)}
      onBack={() => router.back()}
      onPose={(label) => setPose(poseKey(label))}
      onMode={setMode}
      onWipe={setWipe}
      onOlder={(id) => pair && setPicked([id, pair[1].id])}
      onNewer={(id) => pair && setPicked([pair[0].id, id])}
      // A date from the strip replaces the earlier side (the pair re-sorts).
      onThumb={(id) => pair && id !== pair[1].id && setPicked([id, pair[1].id])}
      onRetry={() => void photos.refresh()}
    />
  );
}

import { useRouter } from "expo-router";
import { useCoachClientPhotos } from "@/ui/hooks/useCoachClientPhotos";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { ClientPhotosTabPresenter } from "@/ui/presenters/coachPhotos/ClientPhotosTabPresenter";
import {
  firstNameOf,
  photosState,
  poseKey,
  setRowView,
  showingOffline,
} from "./coachPhotoViews";

/**
 * C3.4b Photos tab on the client page (PER-138): the latest set, then the
 * earlier ones; Compare, a latest photo or an earlier set opens C3.4c.
 */
export function ClientPhotosContainer(p: {
  clientId: string;
  clientName: string | null;
  /** Bumped by the page's pull-to-refresh. */
  refreshKey?: number;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const photos = useCoachClientPhotos(p.clientId, {
    refreshKey: p.refreshKey,
  });
  const state = photosState(photos, online);
  const [latest, ...earlier] = photos.sets;

  const openCompare = (params: { pose?: string; setId?: string }) =>
    router.push({
      pathname: "/(app)/clients/[id]/photos-compare",
      params: {
        id: p.clientId,
        ...(p.clientName ? { name: p.clientName } : {}),
        ...params,
      },
    } as never);

  return (
    <ClientPhotosTabPresenter
      state={state}
      clientFirst={firstNameOf(p.clientName)}
      latest={latest ? setRowView(latest) : null}
      rows={earlier.map(setRowView)}
      offline={showingOffline(photos, online)}
      onCompare={() => openCompare({})}
      onOpenLatest={(pose) => openCompare({ pose: poseKey(pose) })}
      onOpenSet={(setId) => openCompare({ setId })}
      onRetry={() => void photos.refresh()}
    />
  );
}

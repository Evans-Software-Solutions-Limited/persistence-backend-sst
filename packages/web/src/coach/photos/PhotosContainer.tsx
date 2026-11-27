import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isCoachApiError } from "../api/coachApi";
import type { RosterClient } from "../api/types";
import { COACH_NETWORK_MODE, useOnline } from "../hooks/coachQueries";
import { clockTime, firstName } from "../lib/people";
import { LoadError, Loading } from "../ui/parts";
import { PHOTOS_REFRESH_MS, photosKey, usePhotosApi } from "./api";
import { denialOf, newestFirst, orderedPair } from "./lib";
import { PhotosState, PhotosTab } from "./PhotosTab";
import type { CompareMode, PhotoPose } from "./types";

/**
 * Client → Photos (C3.4a, PER-138). Reads the coach gallery; every open and
 * every 4 minutes it reads again, so view links (5 minutes) are fresh.
 * Images are cached by photo id (`usePhotoSrc`). The server decides access:
 * a refusal (switch off, not shared, coaching ended) replaces anything shown.
 */
export function PhotosContainer({ client }: { client: RosterClient }) {
  const api = usePhotosApi();
  const online = useOnline();
  const clientFirst = firstName(client.name);
  const q = useQuery({
    queryKey: photosKey(client.id),
    queryFn: () => api.clientPhotos(client.id),
    networkMode: COACH_NETWORK_MODE,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: PHOTOS_REFRESH_MS,
  });
  const [pose, setPose] = useState<PhotoPose>("front");
  const [mode, setMode] = useState<CompareMode>("side");
  const [wipe, setWipe] = useState(50);
  const [picked, setPicked] = useState<[string, string] | null>(null);

  const sets = useMemo(() => newestFirst(q.data?.sets ?? []), [q.data]);
  const denial = denialOf(q.error);
  const settingsHref = `/coach/clients/${client.id}/settings`;

  if (denial) {
    return (
      <PhotosState
        kind={denial}
        clientFirst={clientFirst}
        settingsHref={settingsHref}
      />
    );
  }
  if (q.isPending) return <Loading />;
  if (!q.data) {
    const offline = !online || (isCoachApiError(q.error) && q.error.offline);
    return (
      <LoadError
        message={
          offline
            ? `You're offline. ${clientFirst}'s photos load when you're back online.`
            : `We couldn't load ${clientFirst}'s photos.`
        }
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (sets.length === 0) {
    return (
      <PhotosState
        kind="empty"
        clientFirst={clientFirst}
        settingsHref={settingsHref}
      />
    );
  }

  const pair = orderedPair(sets, picked);
  const offline = !online || (isCoachApiError(q.error) && q.error.offline);
  const latestId = sets[0]!.id;

  return (
    <PhotosTab
      clientFirst={clientFirst}
      sets={sets}
      pair={pair}
      pose={pose}
      mode={mode}
      wipe={wipe}
      offlineAsOf={offline ? clockTime(q.dataUpdatedAt) : null}
      onPose={setPose}
      onMode={setMode}
      onWipe={setWipe}
      onPickSet={(id) => setPicked(id === latestId ? null : [id, latestId])}
      onOlder={(id) => pair && setPicked([id, pair[1].id])}
      onNewer={(id) => pair && setPicked([pair[0].id, id])}
    />
  );
}

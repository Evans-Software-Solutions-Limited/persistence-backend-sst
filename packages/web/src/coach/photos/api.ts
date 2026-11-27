import { createContext, useContext } from "react";
import { coachFetch } from "../api/coachApi";
import type { ClientPhotos } from "./types";

/**
 * The coach's photo route (PER-121), for the C3.4 Photos tab (PER-138). Its
 * own context, like `CoachApiContext`, so tests hand in a fake and the shared
 * API file stays untouched.
 */
export const photosApi = {
  clientPhotos: async (clientId: string): Promise<ClientPhotos> =>
    (
      await coachFetch<{ data: ClientPhotos }>(
        `/trainers/me/clients/${encodeURIComponent(clientId)}/progress-photos`,
      )
    ).data,
};

/** Under the coach's 5-minute view links, so a link is fresh when it loads. */
export const PHOTOS_REFRESH_MS = 4 * 60_000;

/** Under `["coach", …]`, so signing out drops it too. */
export const photosKey = (clientId: string) =>
  ["coach", "progress-photos", clientId] as const;

export type PhotosApi = typeof photosApi;

export const PhotosApiContext = createContext<PhotosApi>(photosApi);

export function usePhotosApi(): PhotosApi {
  return useContext(PhotosApiContext);
}

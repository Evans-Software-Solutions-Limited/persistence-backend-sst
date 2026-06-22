import type { TrainerClient } from "@/domain/models/trainerClient";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/** Cache is considered stale after 5 minutes (matches the Coach You TTL). */
export const TRAINER_CLIENTS_STALE_AFTER_MS = 5 * 60 * 1000;

export function isTrainerClientsStale(
  syncedAt: string | null,
  now: number,
): boolean {
  if (syncedAt === null) return true;
  const ts = new Date(syncedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return now - ts > TRAINER_CLIENTS_STALE_AFTER_MS;
}

/**
 * Trainer client roster (10-trainer-features). Cache-first from
 * `cached_trainer_clients`, refreshes from `GET /trainers/me/clients`.
 * Mirrors `useGetCoachOverview` — renders the cached snapshot instantly
 * (offline-friendly) then background-refreshes when stale.
 */
export function useGetTrainerClients(): CachedResourceState<TrainerClient[]> {
  return useCachedResource<TrainerClient[]>({
    read: (storage, userId) => ({
      value: storage.getCachedTrainerClients(userId),
      isStale: isTrainerClientsStale(
        storage.getTrainerClientsAge(userId),
        Date.now(),
      ),
    }),
    fetcher: (api) => api.getTrainerClients(),
    write: (storage, userId, value) =>
      storage.cacheTrainerClients(userId, value),
  });
}

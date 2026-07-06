import type { ProgramSummary } from "@/domain/models/program";
import {
  useCachedResource,
  type CachedResourceState,
} from "./useCachedResource";

/** Cache is considered stale after 5 minutes (matches the Coach You TTL). */
export const PROGRAMS_STALE_AFTER_MS = 5 * 60 * 1000;

export function isProgramsStale(syncedAt: string | null, now: number): boolean {
  if (syncedAt === null) return true;
  const ts = new Date(syncedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return now - ts > PROGRAMS_STALE_AFTER_MS;
}

/**
 * Trainer programmes list (19-programs, Phase 9 mobile — coach F1).
 * Cache-first from `cached_programs`, refreshes from
 * `GET /trainers/me/programs`. Mirrors `useGetTrainerClients`. Renders the
 * cached snapshot instantly (offline-friendly) then background-refreshes
 * when stale. Programme DETAIL is never cached here — the editor container
 * fetches it live via `api.getProgram(id)`.
 */
export function useGetPrograms(): CachedResourceState<ProgramSummary[]> {
  return useCachedResource<ProgramSummary[]>({
    read: (storage, userId) => ({
      value: storage.getCachedPrograms(userId),
      isStale: isProgramsStale(storage.getProgramsAge(userId), Date.now()),
    }),
    fetcher: (api) => api.listPrograms(),
    write: (storage, userId, value) => storage.cachePrograms(userId, value),
  });
}

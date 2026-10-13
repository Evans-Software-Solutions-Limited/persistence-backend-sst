import type { QueryClient } from "@tanstack/react-query";
import { getApiBaseUrl } from "@/adapters/api";
import {
  BOOTSTRAP_FRESH_MS,
  rememberBootstrapSection,
} from "@/application/bootstrap/freshness";
import { processSyncQueue } from "@/application/commands/sync.command";
import {
  applyPendingReads,
  optimisticUnread,
} from "@/application/notifications/pending-reads";
import { reconcilePendingBodyMeasurements } from "@/application/queries/pending-body-measurements";
import {
  applyProfilePage,
  captureProfilePageRequestStart,
  getProfilePageQuery,
  type ProfilePageRequestStart,
} from "@/application/queries/profile-page.query";
import { getReferenceListQuery } from "@/application/queries/reference-lists.query";
import {
  applyWorkoutsList,
  getWorkoutsQuery,
} from "@/application/queries/workouts.query";
import type {
  BootstrapPayload,
  BootstrapSectionKey,
  BootstrapSections,
} from "@/domain/models/bootstrap";
import {
  habitConfigFromEntry,
  type HabitConfig,
} from "@/domain/models/habit-config";
import { isHomeStale } from "@/domain/models/progress";
import type { ApiPort } from "@/domain/ports/api.port";
import type { AuthPort } from "@/domain/ports/auth.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { userSubscriptionQueryKey } from "@/ui/hooks/useMySubscription";
import { SUBSCRIPTION_TIERS_QUERY_KEY } from "@/ui/hooks/useSubscriptionTiers";
import type { ApiError, Result } from "@/shared/errors";
import { fail, ok } from "@/shared/errors";

export type BootstrapDeps = {
  api: Pick<ApiPort, "getBootstrap">;
  storage: StoragePort;
  auth: AuthPort;
  userId: string;
  /** Trainer libraries: `mine` is fetched with `ownerLibraryOnly`. */
  ownerLibraryOnly: boolean;
  /** Seeds the subscription and tier queries so their hooks do not fetch. */
  queryClient?: Pick<QueryClient, "setQueryData" | "getQueryState">;
  now?: () => number;
  /** Which sections to ask for; defaults to the ones whose caches are stale. */
  include?: readonly BootstrapSectionKey[];
};

export type BootstrapOutcome = {
  requested: BootstrapSectionKey[];
  applied: BootstrapSectionKey[];
  failed: { section: BootstrapSectionKey; error: string }[];
};

/**
 * Sections whose readers hardcode "stale": the bootstrap always asks for them
 * on a cold start and `recallBootstrapSection` lets their hooks skip the
 * mount-time fetch. Onboarding keeps its own provider-side merge and fetch.
 */
const ALWAYS: readonly BootstrapSectionKey[] = [
  "notifications",
  "habitConfig",
  "habitCompletions",
  "streaks",
  "achievements",
  "volumeStats",
  "bodyTrend",
  "recentPRs",
];

/** Decides which sections are worth a request right now. */
export function staleBootstrapSections(
  storage: StoragePort,
  userId: string,
  queryClient: BootstrapDeps["queryClient"],
  now: number,
): BootstrapSectionKey[] {
  const sections = new Set<BootstrapSectionKey>(ALWAYS);
  if (isHomeStale(storage.getHomeAge(userId), now)) sections.add("home");
  if (getProfilePageQuery(storage, userId, () => now).isStale)
    sections.add("profile");
  const workouts = getWorkoutsQuery(storage, userId);
  if (
    workouts.mine.isStale ||
    workouts.assigned.isStale ||
    workouts.default.isStale
  )
    sections.add("workouts");
  if (getReferenceListQuery(storage, "muscle_groups").isStale)
    sections.add("muscleGroups");
  if (getReferenceListQuery(storage, "equipment").isStale)
    sections.add("equipment");
  if (!queryClient?.getQueryState(userSubscriptionQueryKey(userId))?.data)
    sections.add("subscription");
  if (!queryClient?.getQueryState(SUBSCRIPTION_TIERS_QUERY_KEY)?.data)
    sections.add("tiers");
  return [...sections];
}

type WriteContext = BootstrapDeps & {
  nowMs: number;
  profileRequestStart: ProfilePageRequestStart | null;
};
/** Writes a section; what it returns is stashed in the freshness cache. */
type Writer<K extends BootstrapSectionKey> = (
  value: BootstrapSections[K],
  ctx: WriteContext,
) => unknown;

const writers: { [K in BootstrapSectionKey]: Writer<K> } = {
  home: (value, { storage, userId }) => storage.cacheHome(userId, value),
  profile: (value, { storage, userId, profileRequestStart }) =>
    applyProfilePage(
      storage,
      userId,
      value,
      profileRequestStart ?? captureProfilePageRequestStart(storage, userId),
    ),
  subscription: (value, { queryClient, userId }) =>
    queryClient?.setQueryData(userSubscriptionQueryKey(userId), value),
  tiers: (value, { queryClient }) =>
    queryClient?.setQueryData(SUBSCRIPTION_TIERS_QUERY_KEY, value),
  onboarding: () => undefined,
  workouts: (value, { storage, userId }) => {
    applyWorkoutsList(storage, userId, "mine", value.mine);
    applyWorkoutsList(storage, userId, "assigned", value.assigned);
    applyWorkoutsList(storage, userId, "default", value.default);
  },
  // The hooks keep the optimistic unread count in memory, so stash it.
  notifications: (value, { storage, nowMs }) => {
    storage.cacheNotifications(value.notifications);
    const page = applyPendingReads(
      value.notifications,
      storage,
      new Date(nowMs).toISOString(),
    );
    return optimisticUnread(value.unreadCount, page, storage);
  },
  habitConfig: (value, { storage, userId }) => {
    storage.cacheHabitConfigs(
      userId,
      value
        .map(habitConfigFromEntry)
        .filter((c): c is HabitConfig => c !== null),
    );
    return value;
  },
  // Derived rows (gym, calories) never reach SQLite; `useGetHabits` keeps
  // them in memory, so the bootstrap stashes them for it.
  habitCompletions: (value, { storage, userId }) => {
    storage.cacheHabitCompletions(
      userId,
      value.filter((row) => !row.id.startsWith("derived-")),
    );
    return value.filter((row) => row.id.startsWith("derived-"));
  },
  streaks: (value, { storage, userId }) => storage.cacheStreaks(userId, value),
  achievements: (value, { storage, userId }) =>
    storage.cacheAchievements(userId, value),
  volumeStats: (value, { storage, userId }) =>
    storage.cacheVolumeStats(userId, value),
  bodyTrend: (value, { storage, userId }) =>
    storage.cacheBodyTrend(
      userId,
      reconcilePendingBodyMeasurements(storage, value),
    ),
  recentPRs: (value, { storage, userId }) =>
    storage.cachePersonalRecords(userId, value),
  muscleGroups: (value, { storage }) =>
    storage.cacheReferenceList("muscle_groups", value),
  equipment: (value, { storage }) =>
    storage.cacheReferenceList("equipment", value),
};

/**
 * One request for the app shell, written to SQLite the way each hook does.
 *
 * Drains the sync queue first (a stale GET must not overwrite optimistic
 * rows), asks for the stale sections, applies every returned section in
 * isolation and records what it wrote in the freshness cache so mount-time
 * readers skip their own fetch. A failed section leaves its cache untouched.
 */
export async function runBootstrap(
  deps: BootstrapDeps,
): Promise<Result<BootstrapOutcome, ApiError>> {
  const { api, storage, auth, userId, queryClient } = deps;
  const now = deps.now ?? Date.now;
  try {
    await processSyncQueue(storage, auth, getApiBaseUrl());
  } catch (error) {
    console.error("[bootstrap] queue flush failed:", error);
  }
  const requested =
    deps.include !== undefined
      ? [...deps.include]
      : staleBootstrapSections(storage, userId, queryClient, now());
  if (requested.length === 0) return ok({ requested, applied: [], failed: [] });
  const profileRequestStart = requested.includes("profile")
    ? captureProfilePageRequestStart(storage, userId)
    : null;
  const result = await api.getBootstrap({
    include: requested,
    ownerLibraryOnly: deps.ownerLibraryOnly,
  });
  if (!result.ok) return fail(result.error);
  return ok(
    applySections(result.value, requested, {
      ...deps,
      nowMs: now(),
      profileRequestStart,
    }),
  );
}

function applySections(
  payload: BootstrapPayload,
  requested: BootstrapSectionKey[],
  ctx: WriteContext,
): BootstrapOutcome {
  const applied: BootstrapSectionKey[] = [];
  const failed: BootstrapOutcome["failed"] = [];
  for (const section of requested) {
    const result = payload.sections[section];
    if (!result) {
      failed.push({ section, error: "missing" });
      continue;
    }
    if (!result.ok) {
      failed.push({ section, error: result.error });
      continue;
    }
    try {
      const write = writers[section] as Writer<typeof section>;
      const stash = write(result.value as never, ctx);
      rememberBootstrapSection(
        ctx.userId,
        section,
        ctx.nowMs,
        stash ?? undefined,
      );
      applied.push(section);
    } catch (error) {
      console.error(`[bootstrap] section ${section} write failed:`, error);
      failed.push({
        section,
        error: error instanceof Error ? error.message : "write failed",
      });
    }
  }
  return { requested, applied, failed };
}

export { BOOTSTRAP_FRESH_MS };

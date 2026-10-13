import type { HomeRepositories } from "../progress/loadHome";
import { loadHome } from "../progress/loadHome";
import {
  loadHabitConfig,
  type HabitConfigRepositories,
} from "../habits/config/loadHabitConfig";
import {
  loadVolumeStats,
  type VolumeStatsRepositories,
} from "../progress/loadVolumeStats";
import type { ProfileRepository } from "../repositories/profileRepository";
import type { WorkoutRepository } from "../repositories/workoutRepository";
import type { NotificationRepository } from "../repositories/notificationRepository";
import type { OnboardingStateRepository } from "../repositories/onboardingStateRepository";
import type { ExerciseRepository } from "../repositories/exerciseRepository";
import type { SubscriptionRepository } from "../repositories/subscriptionRepository";
import type { SubscriptionTiersRepository } from "../repositories/subscriptionTiersRepository";
import type { FoundingGrantService } from "../founding/foundingGrantService";
import type { assertEntitlement } from "../entitlement/assertEntitlement";
import type { safeReconcileWorkoutStreak } from "../streaks/evaluate";
import { mapTierRowToWire } from "../subscriptions/tiers/subscriptionsTiersHandler";
import { habitsGridWindow } from "../habits/habitsView";
import { parseBodyTrendWindow } from "../progress/getBodyTrendHandler";
import { BOOTSTRAP_SECTIONS, type BootstrapSection } from "./sections";

/**
 * Everything the composite needs. Repositories come from the Elysia
 * services; the two `new`-per-request repositories and the two side-effect
 * helpers are injected so tests can fake them the same way.
 */
export type BootstrapDeps = HomeRepositories &
  HabitConfigRepositories &
  VolumeStatsRepositories & {
    ProfileRepository: ProfileRepository;
    WorkoutRepository: WorkoutRepository;
    NotificationRepository: NotificationRepository;
    OnboardingStateRepository: OnboardingStateRepository;
    ExerciseRepository: ExerciseRepository;
    subscriptions: Pick<SubscriptionRepository, "findForUser">;
    tiers: Pick<SubscriptionTiersRepository, "listActive">;
    founding: Pick<FoundingGrantService, "applyPendingForUser">;
    assertEntitlement: typeof assertEntitlement;
    reconcileWorkoutStreak: typeof safeReconcileWorkoutStreak;
  };

export type BootstrapRequest = {
  userId: string;
  email: string | undefined;
  sections: readonly BootstrapSection[];
  /** Applies to the `mine` workouts slice only (trainer libraries). */
  ownerLibraryOnly: boolean;
  now?: Date;
};

export type SectionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type BootstrapResponse = {
  generatedAt: string;
  sections: Partial<Record<BootstrapSection, SectionResult<unknown>>>;
};

/**
 * The DB pool is four connections per container and `loadHome` alone fans
 * out seventeen reads, so sections are started at most this many at a time.
 */
export const BOOTSTRAP_CONCURRENCY = 3;
const WORKOUTS_LIMIT = 20;
const NOTIFICATIONS_LIMIT = 50;
const HABIT_WINDOW_DAYS = 7;
const RECENT_PR_LIMIT = 20;
const VOLUME_WINDOW = "month";
const BODY_TREND_WINDOW = "30d";

type Loader = (deps: BootstrapDeps, req: BootstrapRequest) => Promise<unknown>;

const loaders: Record<BootstrapSection, Loader> = {
  home: (d, r) => loadHome(d, r.userId, r.now),
  profile: async (d, r) => {
    const page = await d.ProfileRepository.getProfilePageData(r.userId);
    if (page === null) throw new Error("not_found");
    return page;
  },
  subscription: async (d, r) => {
    await d.founding.applyPendingForUser(r.userId, r.email);
    const sub = await d.subscriptions.findForUser(r.userId);
    if (sub === null) throw new Error("not_found");
    return sub;
  },
  tiers: async (d) => (await d.tiers.listActive()).map(mapTierRowToWire),
  onboarding: (d, r) => d.OnboardingStateRepository.get(r.userId),
  workouts: async (d, r) => {
    const verdict = await d.assertEntitlement(r.userId, "loadout");
    const list = (type: "mine" | "assigned" | "default") =>
      d.WorkoutRepository.list(r.userId, {
        type,
        limit: WORKOUTS_LIMIT,
        offset: 0,
        ownerLibraryOnly: type === "mine" ? r.ownerLibraryOnly : false,
        includeLoadoutVariations: verdict.allowed,
      });
    const [mine, assigned, defaults] = await Promise.all([
      list("mine"),
      list("assigned"),
      list("default"),
    ]);
    const slice = (s: Awaited<ReturnType<typeof list>>) => ({
      workouts: s.workouts,
      total: s.total,
      ...(s.quota ? { quota: s.quota } : {}),
    });
    return {
      mine: slice(mine),
      assigned: slice(assigned),
      default: slice(defaults),
    };
  },
  notifications: async (d, r) => {
    const [unreadCount, page] = await Promise.all([
      d.NotificationRepository.countUnread(r.userId),
      d.NotificationRepository.list(r.userId, {
        limit: NOTIFICATIONS_LIMIT,
        unreadOnly: true,
      }),
    ]);
    return { rows: page.rows, nextCursor: page.nextCursor, unreadCount };
  },
  habitConfig: (d, r) => loadHabitConfig(d, r.userId),
  habitCompletions: async (d, r) => {
    const completions = await d.HabitRepository.list(r.userId, {
      windowDays: HABIT_WINDOW_DAYS,
    });
    const tz = await d.StreakRepository.getUserTimezone(r.userId);
    const derived = await d.StreakRepository.getDerivedHabitCompletions(
      r.userId,
      habitsGridWindow(r.now ?? new Date(), tz, HABIT_WINDOW_DAYS),
      tz,
    );
    return [...completions, ...derived];
  },
  streaks: (d, r) => d.StreakRepository.getActiveStreaksForUser(r.userId),
  achievements: async (d, r) => {
    await d.reconcileWorkoutStreak(r.userId);
    return d.HomeReadRepository.getAchievements(r.userId);
  },
  volumeStats: (d, r) => loadVolumeStats(d, r.userId, VOLUME_WINDOW, r.now),
  bodyTrend: async (d, r) => {
    const tz = await d.HomeReadRepository.getUserTimezone(r.userId);
    return d.HomeReadRepository.getBodyTrend(
      r.userId,
      parseBodyTrendWindow(BODY_TREND_WINDOW),
      tz,
    );
  },
  recentPRs: (d, r) =>
    d.HomeReadRepository.getRecentPRs(r.userId, RECENT_PR_LIMIT),
  muscleGroups: async (d) =>
    (await d.ExerciseRepository.getMuscleGroups()).map((row) => ({
      id: row.id,
      name: row.name,
      display_name: row.displayName,
    })),
  equipment: async (d) =>
    (await d.ExerciseRepository.getEquipmentTypes()).map((row) => ({
      id: row.id,
      name: row.name,
      display_name: null,
      category: row.category ?? null,
    })),
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "failed";
}

/**
 * Loads the requested sections with a bounded fan-out. A section that throws
 * becomes `{ ok: false, error }`; the response itself never fails because
 * one read did. Order of `sections` is preserved in the output.
 */
export async function loadBootstrap(
  deps: BootstrapDeps,
  request: BootstrapRequest,
  concurrency: number = BOOTSTRAP_CONCURRENCY,
): Promise<BootstrapResponse> {
  const queue = BOOTSTRAP_SECTIONS.filter((s) => request.sections.includes(s));
  const settled = new Map<BootstrapSection, SectionResult<unknown>>();
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const section = queue[next++];
      try {
        settled.set(section, {
          ok: true,
          value: await loaders[section](deps, request),
        });
      } catch (error) {
        console.error(`[bootstrap] section ${section} failed`, error);
        settled.set(section, { ok: false, error: errorMessage(error) });
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, queue.length)) },
      worker,
    ),
  );
  // Canonical order regardless of which section finished first.
  const sections: BootstrapResponse["sections"] = {};
  for (const section of queue) sections[section] = settled.get(section)!;
  return {
    generatedAt: (request.now ?? new Date()).toISOString(),
    sections,
  };
}

import type { Achievement } from "./achievement";
import type { HabitCompletion } from "./habit-completion";
import type { NotificationsPage } from "./notification";
import type { OnboardingState } from "./onboarding";
import type { ProfilePageData } from "./profilePage";
import type { BodyTrendPoint, HomePayload, VolumeStats } from "./progress";
import type { PersonalRecord } from "./record";
import type { ReferenceEntry } from "./reference-list";
import type { Streak } from "./streak";
import type { MySubscription, SubscriptionTier } from "./subscription";
import type { Workout, WorkoutQuota } from "./workout";
import type { HabitConfigEntry } from "@/domain/ports/api.port";

/**
 * Sections `GET /users/me/bootstrap` can return, in the server's canonical
 * order. Spec: specs/milestones/COLD-START-BOOTSTRAP/BRIEF.md.
 */
export const BOOTSTRAP_SECTION_KEYS = [
  "home",
  "profile",
  "subscription",
  "tiers",
  "onboarding",
  "workouts",
  "notifications",
  "habitConfig",
  "habitCompletions",
  "streaks",
  "achievements",
  "volumeStats",
  "bodyTrend",
  "recentPRs",
  "muscleGroups",
  "equipment",
] as const;

export type BootstrapSectionKey = (typeof BOOTSTRAP_SECTION_KEYS)[number];

export type BootstrapSectionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type BootstrapWorkoutsSlice = {
  workouts: Workout[];
  total: number;
  quota: WorkoutQuota | null;
};

export type BootstrapSections = {
  home: HomePayload;
  profile: ProfilePageData;
  subscription: MySubscription;
  tiers: SubscriptionTier[];
  onboarding: OnboardingState | null;
  workouts: {
    mine: BootstrapWorkoutsSlice;
    assigned: BootstrapWorkoutsSlice;
    default: BootstrapWorkoutsSlice;
  };
  notifications: NotificationsPage;
  habitConfig: HabitConfigEntry[];
  habitCompletions: HabitCompletion[];
  streaks: Streak[];
  achievements: Achievement[];
  volumeStats: VolumeStats;
  bodyTrend: BodyTrendPoint[];
  recentPRs: PersonalRecord[];
  muscleGroups: ReferenceEntry[];
  equipment: ReferenceEntry[];
};

export type BootstrapPayload = {
  generatedAt: string;
  sections: {
    [K in BootstrapSectionKey]?: BootstrapSectionResult<BootstrapSections[K]>;
  };
};

export type GetBootstrapParams = {
  include: readonly BootstrapSectionKey[];
  /** Trainer libraries: applies to the `mine` workouts slice only. */
  ownerLibraryOnly?: boolean;
};

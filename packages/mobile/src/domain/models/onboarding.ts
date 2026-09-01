import type { SubscriptionTierName } from "./subscription";

export const ONBOARDING_PAGES = [
  "welcome",
  "profile",
  "role",
  "habits",
  "nutrition",
  "train",
  "recommendation",
] as const;

export type OnboardingPage = (typeof ONBOARDING_PAGES)[number];

export const ONBOARDING_INTENT_KEYS = [
  "nutrition_barcode",
  "nutrition_photo_estimate",
  "nutrition_mealprint",
  "training_three_workouts",
  "training_unlimited_workouts",
  "training_loadout",
] as const;

export type OnboardingIntentKey = (typeof ONBOARDING_INTENT_KEYS)[number];
export type OnboardingPath = "athlete" | "coach";
export type CoachClientBand = "1_5" | "6_15" | "16_30";
export type OnboardingStatus = "in_progress" | "completed" | "dismissed";

export type OnboardingState = {
  userId: string;
  version: 1;
  currentPage: OnboardingPage;
  completedPages: OnboardingPage[];
  skippedPages: OnboardingPage[];
  status: OnboardingStatus;
  path: OnboardingPath | null;
  coachClientBand: CoachClientBand | null;
  intentKeys: OnboardingIntentKey[];
  completedAt: string | null;
  dismissedAt: string | null;
  updatedAt: string;
};

export type OnboardingUpdateInput = Omit<
  OnboardingState,
  "userId" | "updatedAt"
>;

export type OnboardingAnalyticsEventName =
  | "onboarding_page_viewed"
  | "onboarding_page_completed"
  | "onboarding_page_skipped"
  | "onboarding_dismissed"
  | "onboarding_completed"
  | "onboarding_intent_changed"
  | "onboarding_recommendation_viewed"
  | "onboarding_plan_selected"
  | "weight_history_opened"
  | "body_fat_history_opened"
  | "measurement_logged_from_history"
  | "estimated_1rm_banner_viewed"
  | "coaching_overview_opened";

export type AnalyticsEventInput = {
  name: OnboardingAnalyticsEventName;
  properties?: Record<string, string | number | boolean | null>;
};

export type OnboardingRecommendation = {
  tierName: SubscriptionTierName;
  reasons: string[];
};

export const DEFAULT_ATHLETE_ONBOARDING_INTENTS: OnboardingIntentKey[] = [
  "nutrition_mealprint",
  "training_loadout",
];

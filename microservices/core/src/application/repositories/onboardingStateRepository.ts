import { eq, sql } from "drizzle-orm";
import { onboardingStates } from "@persistence/db";
import { getDb } from "@persistence/db/client";

export const ONBOARDING_PAGES = [
  "welcome",
  "profile",
  "role",
  "habits",
  "nutrition",
  "train",
  "recommendation",
] as const;
export const ONBOARDING_INTENT_KEYS = [
  "nutrition_barcode",
  "nutrition_photo_estimate",
  "nutrition_mealprint",
  "training_three_workouts",
  "training_unlimited_workouts",
  "training_loadout",
] as const;

export type OnboardingPage = (typeof ONBOARDING_PAGES)[number];
export type OnboardingIntentKey = (typeof ONBOARDING_INTENT_KEYS)[number];
export type OnboardingStatus = "in_progress" | "completed" | "dismissed";

export type OnboardingStateInput = {
  version: 1;
  currentPage: OnboardingPage;
  completedPages: OnboardingPage[];
  skippedPages: OnboardingPage[];
  status: OnboardingStatus;
  path: "athlete" | "coach" | null;
  coachClientBand: "1_5" | "6_15" | "16_30" | null;
  intentKeys: OnboardingIntentKey[];
};

export type OnboardingStateDTO = OnboardingStateInput & {
  userId: string;
  completedAt: string | null;
  dismissedAt: string | null;
  updatedAt: string;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(row: typeof onboardingStates.$inferSelect): OnboardingStateDTO {
  return {
    userId: row.userId,
    version: 1,
    currentPage: row.currentPage as OnboardingPage,
    completedPages: row.completedPages as OnboardingPage[],
    skippedPages: row.skippedPages as OnboardingPage[],
    status: row.status as OnboardingStatus,
    path: row.path as "athlete" | "coach" | null,
    coachClientBand: row.coachClientBand as "1_5" | "6_15" | "16_30" | null,
    intentKeys: row.intentKeys as OnboardingIntentKey[],
    completedAt: iso(row.completedAt),
    dismissedAt: iso(row.dismissedAt),
    updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
  };
}

/** Self-only repository. There is deliberately no list or arbitrary-user read. */
export class OnboardingStateRepository {
  async get(userId: string): Promise<OnboardingStateDTO | null> {
    const rows = await getDb()
      .select()
      .from(onboardingStates)
      .where(eq(onboardingStates.userId, userId))
      .limit(1);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async put(
    userId: string,
    input: OnboardingStateInput,
  ): Promise<OnboardingStateDTO> {
    // The mobile writer serialises progress PUTs. Without an expected revision
    // in this contract, the server cannot distinguish a stale in-progress PUT
    // from an intentional edit. Terminal immutability is the safety boundary
    // we can enforce atomically here; stronger ordering would require CAS.
    const now = new Date();
    const terminalAt = input.status === "in_progress" ? null : now;
    const values = {
      version: 1,
      currentPage: input.currentPage,
      completedPages: [...new Set(input.completedPages)],
      skippedPages: [...new Set(input.skippedPages)],
      status: input.status,
      path: input.path,
      coachClientBand: input.path === "coach" ? input.coachClientBand : null,
      intentKeys: [...new Set(input.intentKeys)],
      completedAt: input.status === "completed" ? terminalAt : null,
      dismissedAt: input.status === "dismissed" ? terminalAt : null,
      updatedAt: now,
    };

    await getDb()
      .insert(onboardingStates)
      .values({ userId, ...values })
      .onConflictDoUpdate({
        target: onboardingStates.userId,
        set: values,
        // A completed/dismissed row is immutable through this progress route.
        // Keeping this condition in SQL makes concurrent stale PUTs safe.
        setWhere: sql`${onboardingStates.status} = 'in_progress'`,
      });

    const stored = await this.get(userId);
    if (!stored) throw new Error("onboarding_state_upsert_failed");
    return stored;
  }
}

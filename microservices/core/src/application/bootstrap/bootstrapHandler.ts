import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { VolumeService } from "../repositories/volumeService";
import { HomeReadService } from "../repositories/homeReadService";
import { HabitConfigService } from "../repositories/habitConfigService";
import { HabitService } from "../repositories/habitService";
import { StreakReadService } from "../repositories/streakReadService";
import { NutritionEntryService } from "../repositories/nutritionEntryService";
import { NutritionTargetService } from "../repositories/nutritionTargetService";
import { SleepService } from "../repositories/sleepService";
import { ProfileService } from "../repositories/profileService";
import { WorkoutService } from "../repositories/workoutService";
import { NotificationService } from "../repositories/notificationService";
import { OnboardingStateService } from "../repositories/onboardingStateService";
import { ExerciseService } from "../repositories/exerciseService";
import { SubscriptionRepository } from "../repositories/subscriptionRepository";
import { SubscriptionTiersRepository } from "../repositories/subscriptionTiersRepository";
import { FoundingGrantService } from "../founding/foundingGrantService";
import { assertEntitlement } from "../entitlement/assertEntitlement";
import { safeReconcileWorkoutStreak } from "../streaks/evaluate";
import { loadBootstrap } from "./loadBootstrap";
import { parseInclude } from "./sections";

/**
 * `GET /users/me/bootstrap?include=home,profile&ownerLibraryOnly=true`
 *
 * One request for everything the app shell reads on a cold start. Each
 * section answers exactly as its single-endpoint route does (shared loaders),
 * so the client can cache them identically. Mounted inside `streaksRoutes`
 * because the root `.use()` chain is at TypeScript's depth limit.
 * Spec: specs/milestones/COLD-START-BOOTSTRAP/BRIEF.md.
 */
export const bootstrapHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(VolumeService)
  .use(HomeReadService)
  .use(HabitConfigService)
  .use(HabitService)
  .use(StreakReadService)
  .use(NutritionEntryService)
  .use(NutritionTargetService)
  .use(SleepService)
  .use(ProfileService)
  .use(WorkoutService)
  .use(NotificationService)
  .use(OnboardingStateService)
  .use(ExerciseService)
  .get(
    "/users/me/bootstrap",
    async (ctx) => {
      const { sub: userId, email } = getUser(ctx);
      const include = parseInclude(ctx.query.include);
      if (!include.ok) {
        ctx.set.status = 400;
        return {
          error: `Unknown bootstrap section: ${include.unknown.join(", ")}`,
        };
      }
      const data = await loadBootstrap(
        {
          ...ctx,
          subscriptions: new SubscriptionRepository(),
          tiers: new SubscriptionTiersRepository(),
          founding: new FoundingGrantService(),
          assertEntitlement,
          reconcileWorkoutStreak: safeReconcileWorkoutStreak,
        },
        {
          userId,
          email,
          sections: include.sections,
          ownerLibraryOnly: ctx.query.ownerLibraryOnly ?? false,
        },
      );
      return { data };
    },
    {
      query: t.Object({
        include: t.Optional(t.String()),
        ownerLibraryOnly: t.Optional(t.BooleanString()),
      }),
    },
  );

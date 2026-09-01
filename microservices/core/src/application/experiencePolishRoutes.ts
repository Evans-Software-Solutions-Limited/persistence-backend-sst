import Elysia from "elysia";
import { exercisesPerformanceSummaryHandler } from "./exercises/performance/exercisesPerformanceSummaryHandler";
import { onboardingRoutes } from "./onboarding/onboardingRoutes";
import { analyticsEventsHandler } from "./analytics/analyticsEventsHandler";

/** Spec 31 routes grouped to preserve api.ts's Elysia type-depth headroom. */
export const experiencePolishRoutes = new Elysia()
  .use(exercisesPerformanceSummaryHandler)
  .use(onboardingRoutes)
  .use(analyticsEventsHandler);

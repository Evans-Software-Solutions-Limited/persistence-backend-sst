import Elysia from "elysia";
import { exercisesEstimatedOneRepMaxHandler } from "./exercises/performance/exercisesEstimatedOneRepMaxHandler";
import { onboardingRoutes } from "./onboarding/onboardingRoutes";
import { analyticsEventsHandler } from "./analytics/analyticsEventsHandler";

/** Spec 31 routes grouped to preserve api.ts's Elysia type-depth headroom. */
export const experiencePolishRoutes = new Elysia()
  .use(exercisesEstimatedOneRepMaxHandler)
  .use(onboardingRoutes)
  .use(analyticsEventsHandler);

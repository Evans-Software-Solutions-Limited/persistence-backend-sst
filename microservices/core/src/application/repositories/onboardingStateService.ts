import Elysia from "elysia";
import { OnboardingStateRepository } from "./onboardingStateRepository";

export const OnboardingStateService = new Elysia({
  name: "OnboardingStateService",
}).decorate("OnboardingStateRepository", new OnboardingStateRepository());

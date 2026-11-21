import Elysia from "elysia";
// PER-108 (BE-A1, design A) — coaching relationships and client onboarding,
// grouped into one sub-app so api.ts adds ONE `.use()` to the root chain (a
// flat root chain trips TS2589; see coachClientOffboardingRoutes.ts). Each
// handler defines its own absolute paths, so grouping adds no prefix.
import { clientProfilesHandler } from "./coaching/clientProfilesHandler";
import {
  clientSettingsHandler,
  declarationHandler,
  invitePreviewHandler,
  myCoachingHandler,
} from "./coaching/coachingHandlers";
// PER-116 (BE-C1, design C) — coach forms, send rules, requests and responses.
import { coachFormsRoutes } from "./coaching/forms/formsHandlers";

export const coachingRoutes = new Elysia()
  .use(clientProfilesHandler)
  .use(clientSettingsHandler)
  .use(declarationHandler)
  .use(invitePreviewHandler)
  .use(myCoachingHandler)
  .use(coachFormsRoutes);

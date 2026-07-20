import Elysia from "elysia";
// 25-coach-client-offboarding — bidirectional relationship end, grouped into a
// single sub-app so api.ts adds ONE `.use()` to the root chain rather than two.
// A flat root `.use()` chain trips TS2589 (Type instantiation is excessively
// deep) once the app gets large — the same reason `trainersOnBehalfRoutes` and
// `nutritionRoutes` exist. Both handlers define their own absolute paths, so
// grouping here adds no prefix and does not change their URLs.
import { trainersRemoveClientHandler } from "./trainers/clients/trainersRemoveClientHandler";
import { clientLeaveCoachHandler } from "./trainers/relationships/clientLeaveCoachHandler";

export const coachClientOffboardingRoutes = new Elysia()
  // DELETE /trainers/me/clients/:clientId — coach removes a client.
  .use(trainersRemoveClientHandler)
  // DELETE /clients/me/relationships/:relationshipId — client leaves a coach.
  .use(clientLeaveCoachHandler);

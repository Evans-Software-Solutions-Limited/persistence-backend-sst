import Elysia from "elysia";
// PER-113 (BE-H1, design H) — You page and coach training reads, grouped into
// one sub-app so the parent adds ONE `.use()` (a flat root chain trips
// TS2589). Each handler defines its own absolute path.
import {
  historyHandler,
  muscleVolumeHandler,
  recapHandler,
  trainingReviewHandler,
} from "./training/trainingHandlers";

export const trainingRoutes = new Elysia()
  .use(muscleVolumeHandler)
  .use(historyHandler)
  .use(recapHandler)
  .use(trainingReviewHandler);

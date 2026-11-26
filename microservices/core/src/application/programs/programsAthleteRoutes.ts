import Elysia from "elysia";
import { programGetHandler } from "./programGetHandler";
import { myProgramAssignmentsCreateHandler } from "./myProgramAssignmentsCreateHandler";

/**
 * The athlete-side programme routes, grouped into ONE sub-app so api.ts keeps a
 * single `.use()` for them (the root chain is on TypeScript's
 * instantiation-depth ceiling, TS2589 — see ../streaksRoutes.ts).
 *
 * - `GET /programs/:id`: the athlete's programme detail (assignment-scoped).
 * - `POST /users/me/program-assignments`: "Me", assign a programme to
 *   yourself (PER-112, design G part 2).
 *
 * Purely a regrouping for `programGetHandler`: no route, guard or ordering
 * change. The two paths can't capture one another.
 */
export const programsAthleteRoutes = new Elysia()
  .use(programGetHandler)
  .use(myProgramAssignmentsCreateHandler);

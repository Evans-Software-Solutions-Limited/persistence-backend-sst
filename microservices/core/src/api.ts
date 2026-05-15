import Elysia from "elysia";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import openapi from "@elysiajs/openapi";

import { coreErrorHandler } from "./shared/errorHandler";
import { exercisesListHandler } from "./application/exercises/list/exercisesListHandler";
import { exercisesSearchHandler } from "./application/exercises/search/exercisesSearchHandler";
import { exercisesGetHandler } from "./application/exercises/get/exercisesGetHandler";
import { exercisesCreateHandler } from "./application/exercises/create/exercisesCreateHandler";
import { exercisesUpdateHandler } from "./application/exercises/update/exercisesUpdateHandler";
import { exercisesDeleteHandler } from "./application/exercises/delete/exercisesDeleteHandler";
import { muscleGroupsHandler } from "./application/exercises/muscle-groups/muscleGroupsHandler";
import { equipmentHandler } from "./application/exercises/equipment/equipmentHandler";
import { categoriesHandler } from "./application/exercises/categories/categoriesHandler";
import { workoutsListHandler } from "./application/workouts/list/workoutsListHandler";
import { workoutsGetHandler } from "./application/workouts/get/workoutsGetHandler";
import { workoutsCreateHandler } from "./application/workouts/create/workoutsCreateHandler";
import { workoutsUpdateHandler } from "./application/workouts/update/workoutsUpdateHandler";
import { workoutsDeleteHandler } from "./application/workouts/delete/workoutsDeleteHandler";
import { profilesGetHandler } from "./application/profiles/get/profilesGetHandler";
import { profilesUpdateHandler } from "./application/profiles/update/profilesUpdateHandler";
import { sessionsCreateHandler } from "./application/sessions/create/sessionsCreateHandler";
import { sessionsListHandler } from "./application/sessions/list/sessionsListHandler";
import { sessionsGetHandler } from "./application/sessions/get/sessionsGetHandler";
import { sessionsUpdateHandler } from "./application/sessions/update/sessionsUpdateHandler";
import { sessionsDeleteHandler } from "./application/sessions/delete/sessionsDeleteHandler";
import { sessionsRecordHandler } from "./application/sessions/record/sessionsRecordHandler";
import { sessionExercisesCreateHandler } from "./application/sessions/exercises/create/sessionExercisesCreateHandler";
import { sessionExercisesGetHandler } from "./application/sessions/exercises/get/sessionExercisesGetHandler";
import { sessionExercisesDeleteHandler } from "./application/sessions/exercises/delete/sessionExercisesDeleteHandler";
import { setsCreateHandler } from "./application/sessions/sets/create/setsCreateHandler";
import { setsGetHandler } from "./application/sessions/sets/get/setsGetHandler";
import { setsUpdateHandler } from "./application/sessions/sets/update/setsUpdateHandler";
import { setsDeleteHandler } from "./application/sessions/sets/delete/setsDeleteHandler";
import { recordsListHandler } from "./application/records/list/recordsListHandler";
import { personalRecordsListHandler } from "./application/personalRecords/list/personalRecordsListHandler";
import { measurementsCreateHandler } from "./application/measurements/create/measurementsCreateHandler";
import { measurementsListHandler } from "./application/measurements/list/measurementsListHandler";
import { goalsCreateHandler } from "./application/goals/create/goalsCreateHandler";
import { goalsListHandler } from "./application/goals/list/goalsListHandler";
import { goalsGetHandler } from "./application/goals/get/goalsGetHandler";
import { goalsUpdateHandler } from "./application/goals/update/goalsUpdateHandler";
import { goalsDeleteHandler } from "./application/goals/delete/goalsDeleteHandler";
import { dashboardHandler } from "./application/dashboard/dashboardHandler";
import { progressStatsHandler } from "./application/progress/progressStatsHandler";
import { progressRecordsHandler } from "./application/progress/progressRecordsHandler";
import { progressHistoryHandler } from "./application/progress/progressHistoryHandler";

const app = new Elysia()
  .use(coreErrorHandler)
  .use(openapi())
  .get("/health", () => ({ status: "ok" }))
  .use(exercisesListHandler)
  // Search MUST be registered before exercisesGetHandler — otherwise the
  // `/exercises/:id` matcher captures "search" as a literal id.
  .use(exercisesSearchHandler)
  .use(exercisesGetHandler)
  .use(exercisesCreateHandler)
  .use(exercisesUpdateHandler)
  .use(exercisesDeleteHandler)
  .use(muscleGroupsHandler)
  .use(equipmentHandler)
  .use(categoriesHandler)
  .use(workoutsListHandler)
  .use(workoutsGetHandler)
  .use(workoutsCreateHandler)
  .use(workoutsUpdateHandler)
  .use(workoutsDeleteHandler)
  .use(profilesGetHandler)
  .use(profilesUpdateHandler)
  .use(sessionsCreateHandler)
  .use(sessionsListHandler)
  .use(sessionsGetHandler)
  .use(sessionsUpdateHandler)
  .use(sessionsDeleteHandler)
  .use(sessionsRecordHandler)
  .use(sessionExercisesCreateHandler)
  .use(sessionExercisesGetHandler)
  .use(sessionExercisesDeleteHandler)
  .use(setsCreateHandler)
  .use(setsGetHandler)
  .use(setsUpdateHandler)
  .use(setsDeleteHandler)
  .use(recordsListHandler)
  .use(personalRecordsListHandler)
  .use(measurementsCreateHandler)
  .use(measurementsListHandler)
  .use(goalsCreateHandler)
  .use(goalsListHandler)
  .use(goalsGetHandler)
  .use(goalsUpdateHandler)
  .use(goalsDeleteHandler)
  .use(dashboardHandler)
  .use(progressStatsHandler)
  .use(progressRecordsHandler)
  .use(progressHistoryHandler);

export type CoreApi = typeof app;

const honoHandler = handle(new Hono().mount("/", app.fetch));

/**
 * Lambda entrypoint with a defensive top-level catch.
 *
 * The Elysia `coreErrorHandler` plugin should turn any thrown error
 * into a structured 500 response, but in production we have observed
 * cases where an error escapes Elysia's lifecycle (e.g. JWKS fetch
 * inside `.derive`, postgres.js TLS / connection errors thrown
 * outside the request span, etc.). Hono's AWS Lambda adapter does
 * NOT wrap `app.fetch` in a try/catch — see
 * `node_modules/hono/dist/adapter/aws-lambda/handler.js` lines 62-74
 * — so an escaped error propagates straight to the Lambda runtime,
 * which logs it as bare `ERROR Error: <message>\n<stack>` without
 * the `.cause` chain. CloudWatch then shows the outer Drizzle
 * "Failed query" wrapper but not the postgres-side reason, making
 * triage blind (this is exactly what produced the 2026-05-04 staging
 * dashboard incident).
 *
 * This wrapper guarantees a single structured `[api:lambda-fatal]`
 * log line carrying the full cause chain, plus a generic 500 JSON
 * body for the client. BACKSTOP only — the Elysia plugin remains the
 * primary handler and fires for in-lifecycle errors.
 */
export const handler: typeof honoHandler = async (event, context) => {
  try {
    return await honoHandler(event, context);
  } catch (err) {
    const requestId =
      typeof context === "object" &&
      context !== null &&
      "awsRequestId" in context
        ? String((context as { awsRequestId?: unknown }).awsRequestId)
        : undefined;

    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    const causes = collectCauseChain(err).map(summarizeCause);

    console.error(
      `[api:lambda-fatal] ${JSON.stringify({
        message,
        requestId,
        causes,
      })}`,
    );
    if (stack) {
      console.error(stack);
    }

    // Cast: Hono's adapter return type is a conditional generic over
    // the LambdaEvent shape (multi-value-headers vs not). The fallback
    // 500 is a fixed shape that's structurally compatible at runtime
    // but doesn't unify with that generic at the type layer. The `as`
    // cast is scoped to this single backstop path.
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "FATAL",
        error: "Internal server error",
        detail: "An internal error occurred. See server logs for details.",
        ...(requestId ? { requestId } : {}),
      }),
      isBase64Encoded: false,
    } as unknown as Awaited<ReturnType<typeof honoHandler>>;
  }
};

// Cause-chain helpers, intentionally duplicated from `errorHandler.ts`
// rather than re-exported. The Lambda backstop must have zero coupling
// to the Elysia plugin lifecycle — even if a future change to
// `errorHandler` regresses (or the module fails to load on cold
// start), the wrapper above still produces a useful log line.
function collectCauseChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error instanceof Error ? error.cause : undefined;
  let depth = 0;
  while (current !== undefined && current !== null && depth < 5) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
    depth += 1;
  }
  return chain;
}

function summarizeCause(link: unknown): Record<string, unknown> | string {
  if (typeof link !== "object" || link === null) {
    return String(link);
  }
  const obj = link as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  if (link instanceof Error) {
    summary.name = link.name;
    summary.message = link.message;
  }
  // Postgres driver errors tack their useful fields directly on the
  // Error instance; Node net errors carry errno / syscall / address /
  // port (so connection-refused / DNS / timeout fail-modes show up
  // structured, not just as a stringified message).
  for (const key of [
    "code",
    "detail",
    "hint",
    "severity",
    "schema",
    "table",
    "column",
    "constraint",
    "where",
    "position",
    "routine",
    "errno",
    "syscall",
    "address",
    "port",
  ]) {
    if (obj[key] !== undefined) {
      summary[key] = obj[key];
    }
  }
  return summary;
}

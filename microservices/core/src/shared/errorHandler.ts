import Elysia from "elysia";

/**
 * Global error-logging + response-shape plugin for the core Elysia app.
 *
 * Elysia's default behaviour on an uncaught throw is to return HTTP 500
 * with an empty / opaque body. Against AWS Lambda behind API Gateway
 * that makes production triage painful — the user sees a 500, the
 * client has no body, CloudWatch logs only show that the Lambda
 * "returned 500" without the trace.
 *
 * This plugin:
 *
 * 1. Logs every error to `console.error` with the request method + path,
 *    the Elysia error code, the message, and the full stack (in that
 *    order so a log-tail terminal shows the most-useful line first).
 *    Lambda forwards console output to CloudWatch automatically.
 *
 * 2. Returns a structured JSON body on every error so the client network
 *    log shows the cause:
 *
 *      { code, error, detail, stack?, requestId?, validation? }
 *
 *    - `stack` is only present when `SST_STAGE !== "production"`.
 *    - `requestId` is read from `x-amz-request-id` so support requests
 *      can pair client + server logs.
 *    - `detail` is replaced with a generic string on production 500s
 *      to avoid leaking driver messages (CWE-209). 4xx details stay
 *      intact — clients need them to map errors to fields.
 *
 * 3. Maps Elysia's built-in error codes to sensible status codes:
 *      - `VALIDATION` → 422
 *      - `NOT_FOUND`  → 404
 *      - `PARSE`      → 400
 *      - everything else → 500
 *
 *    Handlers that want to return 400 / 403 / 404 for domain reasons
 *    (e.g. "not your exercise") continue to set `ctx.set.status`
 *    explicitly and return a normal body — this plugin only fires on
 *    uncaught throws.
 *
 * ## Usage (plugin pattern, preserves type chain)
 *
 * ```ts
 * const app = new Elysia()
 *   .use(coreErrorHandler)      // ← full generic chain preserved
 *   .use(exercisesListHandler)  // ← route types still inferable by Eden
 *   .use(...);
 * ```
 *
 * This is the idiomatic Elysia plugin pattern. Using `.use(plugin)`
 * lets Elysia's type system merge the plugin's error handler into the
 * parent app's generic chain WITHOUT erasing downstream route types —
 * which is what the Eden treaty client relies on. A wrapper function
 * like `coreErrorHandler(app)` would need `Elysia<any,...>` in its
 * signature, collapsing the generics at the call site and breaking
 * Eden type inference.
 */
export const coreErrorHandler = new Elysia({
  name: "core-error-handler",
}).onError(
  // `as: "global"` escalates this hook beyond plugin scope so it fires
  // for errors in ANY handler registered on the parent app via
  // `.use(coreErrorHandler)`. Without it, Elysia scopes plugin hooks
  // locally (i.e. only errors within this Elysia instance's own
  // routes), which would defeat the whole point — the plugin has no
  // routes of its own.
  { as: "global" },
  ({ code, error, set, request }) => {
    const status = httpStatusForCode(code);
    set.status = status;

    const method = request.method;
    const path = new URL(request.url).pathname;
    const requestId = request.headers.get("x-amz-request-id") ?? undefined;

    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const causeChain = collectCauseChain(error);

    // Single structured log line per failed request. Stack on a separate
    // line so CloudWatch's default row wrap still renders the summary.
    console.error(
      `[api:error] ${method} ${path} → ${status} · code=${code} · ${message}${
        requestId ? ` · reqId=${requestId}` : ""
      }`,
    );
    if (stack) {
      console.error(stack);
    }
    // Drizzle (and many ORMs) wrap the real driver error as `.cause` on the
    // thrown Error. Without unwinding that chain the log just shows the
    // outer "Failed query: <sql>" wrapper and the actual Postgres reason
    // (auth, SSL, permission, timeout, pgbouncer mode mismatch, etc.)
    // stays invisible. We log each link so whichever layer produced the
    // real signal lands in CloudWatch.
    for (const [depth, link] of causeChain.entries()) {
      console.error(`[api:error] cause[${depth}]`, link);
    }

    // Validation errors carry Elysia's own `all` array under the hood;
    // surface it so clients can map to fields.
    const validationDetail = extractValidationDetail(error);

    // Strip raw driver messages from production 500s only (CWE-209:
    // information disclosure). Raw Postgres / Drizzle errors can leak
    // column names, SQL fragments, hostnames. Auth throws could leak
    // account existence. Full detail stays in CloudWatch via the log
    // above; support pairs client ↔ server via `requestId`.
    //
    // 4xx client errors keep the detail — they exist to tell the
    // client what's wrong with their input (422 "name: required"),
    // what they were looking for (404 "not found"), etc. Stripping
    // those would make the API useless to consumers.
    //
    // Non-production keeps detail across the board for dev ergonomics.
    const shouldStripDetail = isProduction() && status >= 500;
    const safeDetail = shouldStripDetail
      ? "An internal error occurred. See server logs for details."
      : message;

    return {
      code,
      error: codeToLabel(code),
      detail: safeDetail,
      ...(validationDetail ? { validation: validationDetail } : {}),
      ...(requestId ? { requestId } : {}),
      // Dev-only: surface the cause chain on the response so the Expo
      // network tab shows the real driver error without a CloudWatch
      // round-trip. Production strips this along with `stack` — it can
      // carry DB hostnames, SQL fragments, pooler internals (CWE-209).
      ...(isProduction()
        ? {}
        : {
            stack,
            ...(causeChain.length > 0
              ? { causes: causeChain.map(summarizeCause) }
              : {}),
          }),
    };
  },
);

/**
 * Walk the `.cause` chain on an Error, stopping at depth 5 to avoid
 * pathological cycles. Drizzle wraps the real Postgres error as `.cause`
 * on its DrizzleQueryError; node-postgres + postgres.js both attach the
 * server's error object (with `code`, `detail`, `hint`, `position`, etc.)
 * as the cause's own fields. Without unwinding this, the outer "Failed
 * query" wrapper is all you see.
 */
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

/**
 * Produce a log-/JSON-friendly summary of a cause link. Errors serialize
 * poorly via `JSON.stringify` (message + stack are non-enumerable), and
 * Postgres driver errors tack their useful fields (`code`, `detail`,
 * `hint`, `severity`, `where`, etc.) directly on the Error instance.
 * Pick those off explicitly so they render in the response body.
 */
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
  ]) {
    if (obj[key] !== undefined) {
      summary[key] = obj[key];
    }
  }
  return summary;
}

/**
 * Narrow `error` to extract Elysia's ValidationError `.all` array without
 * falling back to `any`. Works on any object carrying a readonly `all`
 * list of objects.
 */
function extractValidationDetail(error: unknown): readonly unknown[] | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "all" in error &&
    Array.isArray((error as { all?: unknown }).all)
  ) {
    return (error as { all: readonly unknown[] }).all;
  }
  return null;
}

/**
 * Elysia's ErrorCode type in practice is a union of its built-in string
 * codes plus any numeric status a handler threw directly. We take the
 * broadest signature (`string | number`) so the helpers are callable
 * regardless of Elysia's minor-version churn on the exact union shape.
 */
type ErrorCodeInput = string | number;

function httpStatusForCode(code: ErrorCodeInput): number {
  switch (code) {
    case "VALIDATION":
      return 422;
    case "NOT_FOUND":
      return 404;
    case "PARSE":
      return 400;
    default:
      return typeof code === "number" ? code : 500;
  }
}

function codeToLabel(code: ErrorCodeInput): string {
  switch (code) {
    case "VALIDATION":
      return "Validation failed";
    case "NOT_FOUND":
      return "Not found";
    case "PARSE":
      return "Malformed request";
    case "INTERNAL_SERVER_ERROR":
    case "UNKNOWN":
      return "Internal server error";
    default:
      return "Request failed";
  }
}

function isProduction(): boolean {
  return process.env.SST_STAGE === "production";
}

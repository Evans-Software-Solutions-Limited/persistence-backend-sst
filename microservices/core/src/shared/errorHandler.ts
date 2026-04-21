import type Elysia from "elysia";

/**
 * Global error-logging + response-shape hook for the core Elysia app.
 *
 * Elysia's default behaviour on an uncaught throw is to return HTTP 500
 * with an empty / opaque body. Against AWS Lambda behind API Gateway
 * that makes production triage painful — the user sees a 500, the
 * client has no body, CloudWatch logs only show that the Lambda
 * "returned 500" without the trace.
 *
 * This hook:
 *
 * 1. Logs every error to `console.error` with the request method + path,
 *    the Elysia error code, the message, and the full stack (in that
 *    order so a log-tail terminal shows the most-useful line first).
 *    Lambda forwards console output to CloudWatch automatically.
 *
 * 2. Returns a structured JSON body on every error so the client network
 *    log shows the cause:
 *
 *      { code, error, detail, stack?, requestId? }
 *
 *    `stack` is only present when `SST_STAGE` is not `production`, and
 *    `requestId` is read from `x-amz-request-id` so support requests
 *    can pair client + server logs.
 *
 * 3. Maps Elysia's built-in error codes to sensible status codes:
 *      - `VALIDATION` → 422  (request body / query failed t.Object schema)
 *      - `NOT_FOUND`  → 404
 *      - `PARSE`      → 400  (malformed JSON)
 *      - everything else → 500
 *
 *    Handlers that want to return 400 / 403 / 404 for domain reasons
 *    (e.g. "not your exercise") continue to set `ctx.set.status`
 *    explicitly and return a normal body — this hook only fires on
 *    uncaught throws.
 *
 * Usage:
 *
 *    new Elysia()
 *      .use(coreErrorHandler)
 *      .use(...otherHandlers)
 */

type ElysiaErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "PARSE"
  | "INTERNAL_SERVER_ERROR"
  | "INVALID_COOKIE_SIGNATURE"
  | "UNKNOWN";

function httpStatusForCode(code: ElysiaErrorCode | string): number {
  switch (code) {
    case "VALIDATION":
      return 422;
    case "NOT_FOUND":
      return 404;
    case "PARSE":
      return 400;
    default:
      return 500;
  }
}

function isProduction(): boolean {
  return process.env.SST_STAGE === "production";
}

/**
 * Register a global onError hook on an Elysia app. Returns the app so the
 * call chains like `new Elysia().use(coreErrorHandler).use(...)`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function coreErrorHandler(app: Elysia<any, any, any, any, any, any>) {
  return app.onError(({ code, error, set, request }) => {
    const status = httpStatusForCode(code);
    set.status = status;

    const method = request.method;
    const url = new URL(request.url);
    const path = url.pathname;
    const requestId = request.headers.get("x-amz-request-id") ?? undefined;

    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

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

    // Validation errors already carry Elysia's own `all` array under
    // the hood; if present, include it so clients can map to fields.
    // Otherwise return the flat shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validationDetail = (error as any)?.all;

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
      ...(isProduction() ? {} : { stack }),
    };
  });
}

function codeToLabel(code: ElysiaErrorCode | string): string {
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

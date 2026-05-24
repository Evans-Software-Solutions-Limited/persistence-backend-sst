import Elysia from "elysia";
import { EntitlementError } from "../application/entitlement/assertEntitlement";

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
    // EntitlementError is a domain-level deny from the assertEntitlement
    // helper (see microservices/core/src/application/entitlement/
    // assertEntitlement.ts). It carries a structured deny verdict that
    // the mobile feature-gate adapter parses verbatim — we map it to
    // HTTP 402 (Payment Required) with the spec'd snake_case body
    // BEFORE the generic logging / detail-stripping pipeline below,
    // because:
    //
    //   1. The wire shape is fixed: `{ code, error, feature,
    //      current_tier, upgrade_to, upgrade_price_monthly }`. Mobile's
    //      `SSTApiAdapter` looks up these exact field names; the
    //      generic shape (`{ code, error: 'Request failed', detail,
    //      stack, … }`) would break the parse.
    //
    //   2. A 402 is an expected user-facing condition, not a server
    //      fault. The verbose CloudWatch JSON line + stack trace are
    //      noise for this path — we still log a single concise line so
    //      operators can spot "user X hit feature gate Y" patterns,
    //      but we skip the cause chain / driver-error unwinding.
    //
    //   3. The verdict's `currentTier` / `upgradeTo` / `upgradePriceMonthly`
    //      are camelCase inside TS; the wire flips to snake_case (per
    //      design.md § 402 response shape) so REST conventions hold.
    //
    // Spec: specs/11-payments-subscriptions/design.md
    //       § Entitlement enforcement (M10.5) > 402 response shape
    //       specs/11-payments-subscriptions/requirements.md AC 9.2
    if (error instanceof EntitlementError) {
      const status = 402;
      set.status = status;

      const method = request.method;
      const path = new URL(request.url).pathname;
      const requestId = request.headers.get("x-amz-request-id") ?? undefined;

      console.error(
        `[api:402] ${method} ${path} · ${JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          feature: error.feature,
          reason: error.verdict.reason,
          currentTier: error.verdict.currentTier,
          upgradeTo: error.verdict.upgradeTo,
          requestId,
        })}`,
      );

      return {
        code: "ENTITLEMENT_DENIED",
        error: "Subscription does not include this feature",
        feature: error.feature,
        reason: error.verdict.reason,
        current_tier: error.verdict.currentTier,
        upgrade_to: error.verdict.upgradeTo,
        upgrade_price_monthly: error.verdict.upgradePriceMonthly,
        ...(requestId ? { requestId } : {}),
      };
    }

    const status = httpStatusForCode(code);
    set.status = status;

    const method = request.method;
    const path = new URL(request.url).pathname;
    const requestId = request.headers.get("x-amz-request-id") ?? undefined;

    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const causeChain = collectCauseChain(error);
    const causeSummaries = causeChain.map(summarizeCause);

    // Single structured JSON line per failed request. Earlier impl
    // split summary / stack / cause across THREE separate console.error
    // calls; CloudWatch sometimes orphans those into different log
    // entries (especially when copy/pasted out of the console UI), so a
    // user reading "Failed query: ..." in isolation never saw the
    // postgres-side cause. Bundling everything into one line guarantees
    // the cause travels with the summary regardless of how the log is
    // viewed.
    //
    // The leading `[api:error] ${method} ${path} → ${status}` prefix is
    // kept human-scannable for log-tail use; the JSON payload after `· `
    // is what carries the structured detail.
    console.error(
      `[api:error] ${method} ${path} → ${status} · ${JSON.stringify({
        code,
        message,
        requestId,
        // Drizzle (and many ORMs) wrap the real driver error as
        // `.cause` on the thrown Error. Without unwinding that chain
        // the log just shows the outer "Failed query: <sql>" wrapper
        // and the actual Postgres reason (auth, SSL, permission,
        // timeout, pgbouncer mode mismatch, etc.) stays invisible.
        // Inlining `causes` here guarantees the real signal lands
        // alongside the summary.
        causes: causeSummaries,
      })}`,
    );
    if (stack) {
      console.error(stack);
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
            ...(causeSummaries.length > 0 ? { causes: causeSummaries } : {}),
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
  // Postgres driver errors tack their useful fields directly on the
  // Error instance (`code`, `detail`, `hint`, `severity`, etc.). Node
  // net / dns errors carry `errno`, `syscall`, `address`, `port` —
  // including those means connection-refused / TLS / timeout failure
  // modes show up structured rather than as opaque "Failed query"
  // wrappers.
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

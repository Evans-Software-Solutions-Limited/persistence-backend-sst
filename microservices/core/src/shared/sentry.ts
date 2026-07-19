import * as Sentry from "@sentry/aws-serverless";

// The SDK's event/breadcrumb types (`ErrorEvent`, `EventHint`, `Breadcrumb`)
// are NOT re-exported from `@sentry/aws-serverless`, and `@sentry/core` isn't a
// hoisted dependency of this workspace. Derive the exact hook parameter types
// from `Sentry.init`'s own signature — version-proof and import-free.
type SentryInitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type BeforeSend = NonNullable<SentryInitOptions["beforeSend"]>;
type BeforeSendTransaction = NonNullable<
  SentryInitOptions["beforeSendTransaction"]
>;
type BeforeBreadcrumb = NonNullable<SentryInitOptions["beforeBreadcrumb"]>;
type ErrorEvent = Parameters<BeforeSend>[0];
type TransactionEvent = Parameters<BeforeSendTransaction>[0];
type Breadcrumb = Parameters<BeforeBreadcrumb>[0];

/**
 * Sentry crash/error reporting for the core Lambda.
 *
 * Design constraints (see specs/milestones — Sentry brief):
 *   - FAIL-SAFE: init is a no-op when `SENTRY_DSN` is empty/unset (mirrors the
 *     `ExpoAccessToken` optional-secret pattern). A stage without the secret
 *     deploys and runs exactly as before — no throw, no send.
 *   - PII SCRUBBING IS MANDATORY. This app handles health/fitness + nutrition
 *     data. We never enable `sendDefaultPii`, and every outbound event is run
 *     through a scrubber — `scrubEvent` (errors), `scrubTransaction` (traces),
 *     `scrubBreadcrumb` (breadcrumbs) — to strip emails, names, bearer tokens,
 *     JWTs, request bodies, cookies, auth headers, and span data (the channels
 *     through which health/nutrition payloads would otherwise leak).
 *   - `environment` is tagged off the SST stage (`SST_STAGE`, already present on
 *     the Lambda — see errorHandler.ts).
 *   - Minimal cold-start overhead: `Sentry.init` is only called when a DSN is
 *     present; the SDK is otherwise dormant and every capture/flush is a no-op.
 */

// Redaction patterns for free-text fields (exception messages, breadcrumb
// strings, header values). These are the values most likely to carry PII that
// isn't confined to a structured field we can drop outright.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Supabase/GoTrue JWTs (three base64url segments starting `eyJ`). Access +
// refresh tokens flow through this backend, so scrub them anywhere they surface.
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// `Bearer <token>` / `Basic <creds>` authorization values.
const AUTH_VALUE_RE = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;

const REDACTED = "[redacted]";

/** Redact emails, JWTs, and auth values from a free-text string. */
export function redactString(value: string): string {
  return value
    .replace(JWT_RE, `${REDACTED}-token`)
    .replace(AUTH_VALUE_RE, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(EMAIL_RE, `${REDACTED}-email`);
}

// Drizzle serializes a failed query as `Failed query: <sql>\nparams: <values…>`.
// The `params` tail carries the ACTUAL bound values — on a failing INSERT/UPDATE
// that's a user's weight, food name, notes, etc. (health data). The SQL itself
// uses $1/$2 placeholders and is safe + useful for debugging, so keep it and
// drop only the values. Applied to exception messages before they leave the
// process — the generic token scrubber (`redactString`) can't recognise a bare
// numeric weight or a name as sensitive.
const QUERY_PARAMS_RE = /\nparams:[\s\S]*$/i;
export function stripQueryParams(value: string): string {
  return value.replace(QUERY_PARAMS_RE, "\nparams: [redacted]");
}

// Postgres data-exceptions inline the offending USER value in the message, e.g.
// `invalid input syntax for type timestamp: "13/13/2026"`. Sentry's linkedErrors
// integration ships the pg `.cause` as its own `exception.values[]` entry — past
// the params scrubber (there is no `params:` tail here). Redact the quoted value
// but keep the type, so the message stays diagnostic without carrying input.
const PG_SYNTAX_VALUE_RE = /(invalid input syntax for type \w+: )"[^"]*"/gi;
export function redactPgSyntaxValue(value: string): string {
  return value.replace(PG_SYNTAX_VALUE_RE, `$1"${REDACTED}"`);
}

// Guards against a pathological deeply-nested structure; Sentry payloads are
// plain JSON and never this deep.
const MAX_REDACT_DEPTH = 8;

/**
 * Recursively redact every string reachable from `value` (strings inside
 * nested objects/arrays too — a console breadcrumb's `arguments` array or a
 * structured payload can bury an email/JWT). Mutates objects/arrays in place
 * and returns the (possibly transformed) value.
 */
function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (
    value === null ||
    typeof value !== "object" ||
    depth >= MAX_REDACT_DEPTH
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = redactDeep(value[i], depth + 1);
    }
    return value;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    obj[key] = redactDeep(obj[key], depth + 1);
  }
  return obj;
}

/**
 * Scrub the fields common to BOTH error and transaction events: user context,
 * request context, message, breadcrumbs, extra, and contexts. Mutates in
 * place. `scrubEvent`/`scrubTransaction` layer their event-type-specific
 * scrubbing (exceptions / spans) on top.
 */
function scrubSharedFields(event: ErrorEvent | TransactionEvent): void {
  // User context: keep only the opaque id (useful for triage correlation, not
  // itself health data). Emails, usernames, and IPs are PII → drop them. We
  // never call `setUser`, but scrub defensively in case an integration adds it.
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : {};
  }

  // Request context: the body (`data`) is where nutrition/health/measurement
  // payloads live — drop it wholesale. Cookies + auth/cookie headers carry
  // session tokens — drop/redact them. The query string + URL can carry
  // ids/tokens — redact rather than parse.
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (typeof event.request.query_string === "string") {
      event.request.query_string = redactString(event.request.query_string);
    }
    if (typeof event.request.url === "string") {
      event.request.url = redactString(event.request.url);
    }
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        const lower = key.toLowerCase();
        if (lower === "authorization" || lower === "cookie") {
          event.request.headers[key] = REDACTED;
        } else {
          event.request.headers[key] = redactString(event.request.headers[key]);
        }
      }
    }
  }

  // Breadcrumbs attached to the event (e.g. captured HTTP/console trail).
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b));
  }

  // `extra` (arbitrary attached data, incl. anything passed to captureFatal)
  // and `contexts` (auto-populated request/runtime context) — deep-redact both.
  if (event.extra) redactDeep(event.extra);
  if (event.contexts) redactDeep(event.contexts);

  // Top-level message — both the plain string and the structured logentry form.
  if (typeof event.message === "string") {
    event.message = redactString(event.message);
  }
  const logentry = (
    event as { logentry?: { message?: string; formatted?: string } }
  ).logentry;
  if (logentry) {
    if (typeof logentry.message === "string") {
      logentry.message = redactString(logentry.message);
    }
    if (typeof logentry.formatted === "string") {
      logentry.formatted = redactString(logentry.formatted);
    }
  }
}

/**
 * beforeSend: strip PII from an outbound ERROR event.
 *
 * Exported so it can be unit-tested directly and reused as the `beforeSend`
 * hook. Mutates and returns the event (Sentry's contract). Never returns null
 * — we always want the (scrubbed) crash, just never the PII inside it.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  scrubSharedFields(event);

  // Exception messages can echo user-supplied values (e.g. a validation error
  // quoting the offending input, or a Drizzle "Failed query: … params: […]"
  // carrying the bound row values). Redact tokens/emails AND drop the query
  // params tail.
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (typeof ex.value === "string") {
        ex.value = redactPgSyntaxValue(
          stripQueryParams(redactString(ex.value)),
        );
      }
    }
  }

  return event;
}

/**
 * beforeSendTransaction: strip PII from an outbound TRANSACTION (performance)
 * event. `beforeSend` does NOT fire for transaction events, so with tracing
 * enabled these need their own scrub to uphold the "every outbound event is
 * scrubbed" invariant. Beyond the shared fields, span descriptions + span data
 * (e.g. `db.statement`, `http.url`) can carry sensitive values, so redact them.
 */
export function scrubTransaction(event: TransactionEvent): TransactionEvent {
  scrubSharedFields(event);

  if (event.spans) {
    for (const span of event.spans) {
      if (typeof span.description === "string") {
        span.description = redactString(span.description);
      }
      // Span data values are typed `SpanAttributeValue`; deep-redact via a
      // loose alias (redactDeep only swaps strings, leaving other attribute
      // values intact).
      if (span.data) redactDeep(span.data as Record<string, unknown>);
    }
  }

  return event;
}

/**
 * beforeBreadcrumb: redact PII from a breadcrumb before it's buffered.
 *
 * Console/HTTP breadcrumbs can capture URLs (with query params) and logged
 * strings. Redact the message and any string data values; drop nothing.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = redactString(breadcrumb.message);
  }
  if (breadcrumb.data) redactDeep(breadcrumb.data);
  return breadcrumb;
}

let enabled = false;

/** Whether Sentry was initialised (a DSN was present). */
export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * Initialise Sentry from `SENTRY_DSN`. No-op (returns false) when the DSN is
 * empty/unset so DSN-less stages deploy and run unchanged. Idempotent-safe:
 * only the first init with a DSN takes effect.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    enabled = false;
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.SST_STAGE ?? "unknown",
    // Low trace sampling — errors are always captured; traces are a fraction.
    tracesSampleRate: 0.1,
    // Never attach IPs / request bodies automatically. All scrubbing is ours.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    // `beforeSend` does NOT run on transaction events — scrub those separately
    // so span data (db.statement / http.url) is covered when tracing is on.
    beforeSendTransaction: scrubTransaction,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  enabled = true;
  return true;
}

/**
 * Report a fatal error caught outside Sentry's automatic capture (the Lambda
 * backstop in api.ts). No-op when Sentry is disabled.
 */
export function captureFatal(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!enabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/**
 * Report a handled server-side fault (a 5xx that the Elysia `onError` hook
 * caught and turned into a normal response). Because the error never escapes
 * the Lambda, neither `Sentry.wrapHandler` nor `captureFatal` sees it — so this
 * is the only way an in-lifecycle 500 reaches Sentry rather than living solely
 * in CloudWatch. No-op when Sentry is disabled. PII is scrubbed by `beforeSend`.
 */
export function captureServerError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!enabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/**
 * Wrap a Lambda handler with Sentry when enabled, else return it untouched.
 * `Sentry.wrapHandler` attaches request context and — critically for Lambda —
 * flushes buffered events before the runtime freezes the container. Returns the
 * handler's exact type so callers keep their signature. Must be called after
 * `initSentry()` so `enabled` is settled.
 */
export function wrapLambda<H>(handler: H): H {
  if (!enabled) return handler;
  return Sentry.wrapHandler(handler as never) as unknown as H;
}

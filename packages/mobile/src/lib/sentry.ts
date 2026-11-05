import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";
import type {
  Breadcrumb,
  ErrorEvent,
  TransactionEvent,
} from "@sentry/react-native";

/**
 * Sentry crash/error reporting for the mobile app.
 *
 * Design constraints (see the Sentry brief):
 *   - FAIL-SAFE: `initSentry()` is a no-op when `EXPO_PUBLIC_SENTRY_DSN` is
 *     empty/unset (mirrors the backend + the `ExpoAccessToken` pattern). Local
 *     `expo start` and any build without the DSN run exactly as before.
 *   - PII SCRUBBING IS MANDATORY. This app handles health/fitness + nutrition
 *     data. We never enable `sendDefaultPii`; every outbound event is run
 *     through a scrubber (`scrubEvent` / `scrubTransaction` / `scrubBreadcrumb`)
 *     to strip emails, names, bearer tokens, JWTs, request bodies, and any
 *     nutrition/health payloads that could ride along in breadcrumbs, span
 *     data, or error messages.
 *   - `environment` is tagged off the build variant (`extra.appVariant`, set in
 *     app.config.ts): production / staging / development.
 */

// Redaction patterns for free-text fields. Kept in sync with the backend
// scrubber (the sibling Sentry PR's microservices/core/src/shared/sentry.ts)
// so both rails strip the same PII.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Supabase/GoTrue JWTs (three base64url segments starting `eyJ`).
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

// Guards against a pathological deeply-nested structure; Sentry payloads are
// plain JSON and never this deep.
const MAX_REDACT_DEPTH = 8;

/**
 * Recursively redact every string reachable from `value` (strings inside
 * nested objects/arrays too — a console breadcrumb's `arguments` array or a
 * structured HTTP payload can bury an email/JWT). Mutates objects/arrays in
 * place and returns the (possibly transformed) value.
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

/** Scrub the fields common to error + transaction events (mutates in place). */
function scrubSharedFields(event: ErrorEvent | TransactionEvent): void {
  // User context: keep only the opaque id; drop email/username/ip. We never
  // call `setUser`, but scrub defensively in case an integration adds it.
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : {};
  }

  // Request context: drop the body (nutrition/health/measurement payloads) and
  // cookies; redact auth/cookie headers, the query string, and the URL.
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

  // Breadcrumbs (navigation / xhr / console trail).
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b));
  }

  // `extra` (arbitrary attached data, incl. anything a caller passes to
  // captureBoundaryError) and `contexts` (Sentry auto-populates device/app/os).
  // Deep-redact both for emails/tokens.
  if (event.extra) redactDeep(event.extra);
  if (event.contexts) {
    redactDeep(event.contexts);
    // `device.name` is Sentry-auto-populated and on Android is the user-set
    // device name — often the owner's real name (e.g. "Sarah's Phone"). We
    // can't pattern-match an arbitrary name, so drop the field wholesale.
    const device = (event.contexts as { device?: { name?: unknown } }).device;
    if (device && "name" in device) device.name = REDACTED;
  }

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

/** beforeSend: strip PII from an outbound ERROR event. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  scrubSharedFields(event);

  // Exception messages can echo user-supplied values.
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (typeof ex.value === "string") ex.value = redactString(ex.value);
    }
  }

  return event;
}

/**
 * beforeSendTransaction: strip PII from an outbound TRANSACTION event.
 * `beforeSend` does NOT fire for transaction events, so scrub them separately
 * (span descriptions + span data can carry URLs/queries) to keep the "every
 * outbound event is scrubbed" invariant with tracing enabled.
 */
export function scrubTransaction(event: TransactionEvent): TransactionEvent {
  scrubSharedFields(event);

  if (event.spans) {
    for (const span of event.spans) {
      if (typeof span.description === "string") {
        span.description = redactString(span.description);
      }
      if (span.data) redactDeep(span.data);
    }
  }

  return event;
}

/** beforeBreadcrumb: redact PII from a breadcrumb before it's buffered. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = redactString(breadcrumb.message);
  }
  if (breadcrumb.data) redactDeep(breadcrumb.data);
  return breadcrumb;
}

/** The build variant, injected into `extra.appVariant` by app.config.ts. */
function resolveEnvironment(): string {
  const variant = Constants.expoConfig?.extra?.appVariant;
  return typeof variant === "string" && variant.length > 0
    ? variant
    : "development";
}

let enabled = false;

/** Whether Sentry was initialised (a DSN was present). */
export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * Initialise Sentry from `EXPO_PUBLIC_SENTRY_DSN`. No-op (returns false) when
 * the DSN is empty/unset so DSN-less builds run unchanged. Call before the app
 * renders (app/_layout.tsx module load).
 */
export function initSentry(): boolean {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) {
    enabled = false;
    return false;
  }

  Sentry.init({
    dsn,
    environment: resolveEnvironment(),
    // Low trace sampling — errors are always captured; traces are a fraction.
    tracesSampleRate: 0.1,
    // Never attach IPs / device PII automatically. All scrubbing is ours.
    sendDefaultPii: false,
    beforeSend: safeScrubEvent,
    // `beforeSend` does NOT run on transaction events — scrub those too.
    beforeSendTransaction: scrubTransaction,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  enabled = true;
  return true;
}

/**
 * `beforeSend` that never drops an event silently. A scrubber that throws
 * makes the SDK discard the event with no trace in Sentry; instead send a
 * stripped copy (title, level, tags, fingerprint and release only: nothing the
 * scrubber would have had to clean) tagged `scrub.failed`, so the failure is
 * visible and can be fixed.
 */
export function safeScrubEvent(event: ErrorEvent): ErrorEvent {
  try {
    return scrubEvent(event);
  } catch {
    const title =
      event.exception?.values?.[0]?.type ??
      (typeof event.message === "string" ? "message" : "event");
    return {
      type: event.type,
      event_id: event.event_id,
      timestamp: event.timestamp,
      platform: event.platform,
      level: event.level,
      release: event.release,
      environment: event.environment,
      fingerprint: event.fingerprint,
      message: `Scrubbing failed for a ${title}`,
      tags: { ...event.tags, "scrub.failed": "true" },
    };
  }
}

const SENTRY_CHECK_KEY = "sentry-check-sent";

/**
 * Non-production builds send one "Sentry check" message per app build, so a
 * TestFlight build that reports nothing can be told apart from one whose
 * events never reach Sentry. Production never sends it. Storage is injected
 * (AsyncStorage in the app); a storage failure skips the check.
 */
export async function sendSentryCheck(storage: {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}): Promise<boolean> {
  const environment = resolveEnvironment();
  if (!enabled || environment === "production") return false;
  // The native values: EAS sets the build number remotely, into the native
  // project, not into the embedded Expo config.
  const build = [
    Application.nativeApplicationVersion ?? "unknown",
    Application.nativeBuildVersion ?? "unknown",
  ].join("+");
  try {
    if ((await storage.getItem(SENTRY_CHECK_KEY)) === build) return false;
    Sentry.captureMessage("Sentry check", {
      level: "info",
      tags: { "sentry.check": "true", "app.build": build },
    });
    await storage.setItem(SENTRY_CHECK_KEY, build);
    return true;
  } catch {
    return false;
  }
}

/** Report an error caught by the React ErrorBoundary. No-op when disabled. */
export function captureBoundaryError(
  error: Error,
  context?: Record<string, unknown>,
): void {
  if (!enabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/**
 * Report a failure to initialise the local SQLite database.
 *
 * This used to be a bare `console.error` in `AppProviders`, which made it
 * invisible: if `initialize()` throws, the tables don't exist, and every
 * subsequent cached read throws `no such table` from inside a render-phase
 * `useMemo` — so what Sentry actually received was an ErrorBoundary report
 * pointing at a random screen, with the real cause nowhere in the event. This
 * reports the root cause directly, tagged so it groups on its own.
 *
 * No-op when disabled.
 */
export function captureStorageInitFailure(error: unknown): void {
  if (!enabled) return;
  Sentry.captureException(
    error instanceof Error ? error : new Error(String(error)),
    { level: "fatal", tags: { subsystem: "storage_init" } },
  );
}

/**
 * Report a sync-queue mutation that has exhausted its retry budget. Such an
 * entry is dropped from the drain forever (`getPendingMutations` gates on
 * `retry_count < max_retries`) with no user recovery path — a silently-stuck
 * mutation. Before this, those were invisible in Sentry (the sync path treats a
 * server error as a handled `Result.fail`, never an uncaught exception), which
 * is how the local-workout-id 500 went unnoticed until manual testing.
 *
 * The exception message intentionally OMITS the concrete endpoint (which can
 * embed ids) so Sentry groups by entity/operation rather than one issue per id;
 * the endpoint + server message ride along as `extra`. No-op when disabled.
 */
export function captureSyncFailure(info: {
  endpoint: string;
  entityType: string;
  operation: string;
  message: string;
  status?: number;
}): void {
  if (!enabled) return;
  Sentry.captureException(
    new Error(
      `Sync mutation exhausted retries: ${info.entityType}/${info.operation}`,
    ),
    {
      level: "error",
      tags: { sync_entity: info.entityType, sync_operation: info.operation },
      extra: {
        endpoint: info.endpoint,
        serverMessage: info.message,
        ...(info.status != null ? { status: info.status } : {}),
      },
    },
  );
}

export { Sentry };

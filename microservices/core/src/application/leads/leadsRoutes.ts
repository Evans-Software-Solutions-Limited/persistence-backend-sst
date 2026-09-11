import { buildInternalEmail } from "../email/emailShell";
import Elysia, { t } from "elysia";
import {
  addContactToAudience,
  getResendAthletesAudienceId,
  getResendCoachesAudienceId,
  RESEND_NOTIFICATION_TO,
  sendEmail,
} from "./resendClient";
import { emitEvent } from "../analytics/emitEvent";
import type { AnalyticsEventInput } from "../analytics/events";
import { verifyTurnstile } from "./turnstile";
import { clientIp, rateLimitExceeded } from "./rateLimit";

/**
 * Marketing lead + conversion capture — PUBLIC (no auth) endpoints backing the
 * website's waitlist + coach-enquiry forms and the outbound App Store-click
 * conversion (spec-30 R3.8). Grouped into ONE sub-app so it can be mounted with
 * a single `.use()`, mirroring `jobsRoutes` / `trainersOnBehalfRoutes`.
 *
 * Mounted inside `loadoutRoutes` (see ../loadoutRoutes.ts) rather than
 * directly on the api.ts root: the root `.use()` chain was already at TS's
 * instantiation-depth ceiling (TS2589) — confirmed by adding this as a 24th
 * root `.use()` before moving it — and the Eden `treaty<CoreApi>` client in
 * packages/web instantiates the whole route type, so a backend-only change
 * flipping that would break a package with no edited files. Both routes
 * declare absolute paths, so nesting adds no prefix.
 *
 * There is no database for leads — Resend Audiences ARE the store (see
 * ./resendClient). Both routes: a non-empty `hp` (honeypot) field silently
 * drops the submission as a bot with a 200, WITHOUT calling Resend.
 *
 * ABUSE GATE (all three public endpoints — `/leads/waitlist`, `/leads/coach`,
 * `/store-click`). Unthrottled they are abuse vectors:
 *   - `/leads/coach` fires an internal notification email per accepted request
 *     (email-amplification + Resend-quota abuse);
 *   - `/store-click` writes an `analytics_events` row per request (table
 *     inflation — the 7-day age-out only stamps, it doesn't delete) and, worse,
 *     a script posting `{marketing_consent:true, fbp:…}` can forge `AppStoreClick`
 *     conversions and pollute the very ad-optimisation signal this exists for.
 *
 * TWO layers, defence-in-depth:
 *   1. EDGE (primary) — a CloudFront distribution carrying a WAFv2 rate-based
 *      rule fronts these routes for browser traffic (WAF can't attach to this
 *      HTTP API v2 directly; see infra/web-edge.ts). WAF keys on the TRUE viewer
 *      IP, so this is the real, distributed-aware control the ad-driven traffic
 *      flows through — and it is where the website sends every request.
 *   2. ORIGIN (this file, backstop) — a best-effort per-container in-memory
 *      per-IP limiter (`./rateLimit`) on the handlers themselves, because the
 *      raw API-Gateway URL stays public (it's in the mobile bundle) and a script
 *      that discovers it can hit these routes DIRECTLY, bypassing the edge WAF.
 *      ⚠ It keys on the first `X-Forwarded-For` hop, which on the origin-direct
 *      path is CLIENT-CONTROLLABLE — a script sending a random `X-Forwarded-For`
 *      per request gets a fresh bucket and slips it. So this backstop stops the
 *      NAIVE single-IP script, not a header-spoofing one; the durable answer for
 *      the origin-direct path is to make the edge the ENFORCED ingress (an
 *      origin-lock shared-secret header CloudFront injects + these routes
 *      require — a documented follow-up, deliberately not bolted on unverified
 *      here). On the edge path the first hop IS the real viewer IP (CloudFront
 *      sets it), so there the backstop is a genuine per-user limit under the WAF.
 *      Honest scope + why it's per-container: see the header of ./rateLimit.
 *
 * CORS — these three routes are the ONLY endpoints a browser calls cross-origin
 * (the marketing site's origin ≠ the API origin ≠ the marketing-edge CloudFront
 * host), so each carries permissive CORS headers (see `withCors` below) and a
 * preflight `OPTIONS` handler. Without them the leads `fetch`, which reads the
 * JSON response, is blocked at preflight. `Access-Control-Allow-Origin: *` is
 * deliberate and safe: these are PUBLIC, anonymous, credential-less endpoints
 * (no cookies / Authorization), so a wildcard grants a browser nothing it
 * couldn't already get from `curl` — CORS is not their security boundary.
 *
 * Bounded input (maxLength below) + the honeypot remain the first line. The
 * store CTA is NOT live yet (`config.appStore.url` is null), so nothing drives
 * `/store-click` publicly today — these gates activate when Brad flips the CTA on.
 */

// Per-IP, per-minute origin-backstop budgets. Generous on purpose — the edge
// WAF is the real throttle; this only has to stop a naive script hammering the
// raw API-Gateway URL. Leads is the tighter bucket (each accepted coach lead can
// send an email); store-click is a fast anonymous beacon fired once per real
// CTA tap, so a higher ceiling still leaves ample headroom for legitimate bursts.
const RATE_WINDOW_MS = 60_000;
const LEAD_RATE_LIMIT = 10;
const STORE_CLICK_RATE_LIMIT = 60;

/**
 * True when this caller has EXCEEDED `limit` for `bucket` in the current window.
 * Keys on the first `X-Forwarded-For` hop; an absent header shares one
 * conservative `"unknown"` bucket rather than going unlimited. Separate `bucket`
 * prefixes keep the leads and store-click budgets independent per IP.
 *
 * ⚠ The first hop is the real viewer IP only when the request came through our
 * CloudFront edge (WAF is the control there). On the origin-direct path it is
 * client-controllable and spoofable — see the header's layer-2 note. This is a
 * naive-script backstop, not a spoof-proof limit.
 */
function rateLimited(
  headers: Record<string, string | undefined>,
  bucket: string,
  limit: number,
): boolean {
  const ip = clientIp(headers["x-forwarded-for"]);
  return rateLimitExceeded(`${bucket}:${ip}`, limit, RATE_WINDOW_MS);
}

// Permissive CORS for the browser-facing marketing routes (see header). Safe on
// these PUBLIC, credential-less endpoints; `*` avoids an origin allowlist the
// backend would otherwise have to track per stage.
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

/**
 * Stamp CORS headers onto the response. Called once at the TOP of each handler
 * so every response the handler itself returns — 200, 400, 429, 503 — carries
 * them (`ctx.set` is the response context, mutated in place, so one early call
 * suffices). Schema-validation failures short-circuit BEFORE the handler runs,
 * so those (422s) are covered separately by the `onError` hook below — without
 * it the browser couldn't read a validation error and the form would show a
 * generic failure instead of the field message.
 */
function withCors(ctx: {
  set: { headers: Record<string, string | number> };
}): void {
  Object.assign(ctx.set.headers, CORS_HEADERS);
}

/**
 * Shared CORS preflight response for the marketing routes. Returned as a bare
 * `Response` (not via `ctx.set`) because a 204 is a null-body status — returning
 * a string body with status 204 throws at the Response constructor.
 */
function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isHoneypotTripped(hp: string | undefined): boolean {
  return typeof hp === "string" && hp.length > 0;
}

/** Splits a free-text display name into Resend's first/last name fields. */
function splitName(name: string | undefined): {
  firstName?: string;
  lastName?: string;
} {
  const trimmed = name?.trim();
  if (!trimmed) return {};
  const parts = trimmed.split(/\s+/);
  const firstName = parts[0];
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
  return lastName !== undefined ? { firstName, lastName } : { firstName };
}

interface WebAttribution {
  fbc?: string;
  fbp?: string;
  eventId?: string;
  /**
   * The visitor's marketing-consent choice, carried from the browser
   * (`getConsent() === "granted"`). A boolean is NOT PII (HC-4), so it is safe
   * to persist in `properties`; the CAPI drainer gates forwarding on it
   * (spec-30 R2.7). Absent → false → fail closed.
   */
  marketingConsent?: boolean;
  /** Store destination for an outbound app-download click. */
  store?: "ios" | "android";
  /** First-party referral attribution. Persisted, never forwarded to Meta. */
  ref?: string;
  /**
   * The marketing site's campaign slug (`meta`, `uon`, `flyer`, …) — the
   * CHANNEL key. `ref` names a partner's code and is usually absent, and
   * neither Apple's `ct` nor Google's install `referrer` ever comes back to
   * us, so this is the only thing that lets a first-party row say which
   * channel produced the click. Persisted, never forwarded to Meta
   * (see `analytics/metaEventMap.ts`).
   */
  campaign?: string;
}

/**
 * Build the best-effort `lead_captured` event (spec-30 R1.4 / R3.2 / R2.7).
 *
 * `fbc`/`fbp` are Meta click identifiers, `event_id` is the pixel dedup key, and
 * `marketing_consent` is a boolean — none is PII, so all are safe to persist in
 * `properties` for the CAPI drainer to forward, dedup, and consent-gate.
 */
function leadCapturedEvent(
  audience: "athletes" | "coaches",
  attribution: WebAttribution,
): AnalyticsEventInput {
  const properties: Record<string, unknown> = {
    audience,
    marketing_consent: attribution.marketingConsent === true,
  };
  if (attribution.fbc) properties.fbc = attribution.fbc;
  if (attribution.fbp) properties.fbp = attribution.fbp;
  return {
    name: "lead_captured",
    source: "web",
    eventId: attribution.eventId,
    properties,
  };
}

/** Build the best-effort `store_click` conversion event (spec-30 R3.8). */
function storeClickEvent(attribution: WebAttribution): AnalyticsEventInput {
  const properties: Record<string, unknown> = {
    marketing_consent: attribution.marketingConsent === true,
  };
  if (attribution.fbc) properties.fbc = attribution.fbc;
  if (attribution.fbp) properties.fbp = attribution.fbp;
  if (attribution.store) properties.store = attribution.store;
  if (attribution.ref) properties.ref = attribution.ref;
  if (attribution.campaign) properties.campaign = attribution.campaign;
  return {
    name: "store_click",
    source: "web",
    eventId: attribution.eventId,
    properties,
  };
}

interface StoreClickBody {
  fbc?: string;
  fbp?: string;
  event_id?: string;
  marketing_consent?: boolean;
  store?: "ios" | "android";
  ref?: string;
  campaign?: string;
}

/**
 * The marketing site's campaign slugs are a code-level map (`CAMPAIGNS` in
 * packages/web), not a table, so this endpoint cannot check membership. It
 * bounds the SHAPE instead — the same character class every slug in that map
 * already uses — so an attacker cannot smuggle arbitrary text into
 * `properties.campaign` and the column stays groupable in the admin
 * attribution queries.
 */
const CAMPAIGN_SLUG_RE = /^[a-z0-9-]{1,32}$/;

/**
 * Parse the `/store-click` body from EITHER a `text/plain` beacon — the
 * PRODUCTION path — or an `application/json` post. The beacon must be a CORS
 * "simple request" (text/plain) so `navigator.sendBeacon` actually delivers it
 * cross-origin: sendBeacon cannot send a preflighted request, and
 * `application/json` is not a safelisted content-type, so an `application/json`
 * beacon would be silently dropped by the browser. A simple request is
 * DELIVERED cross-origin regardless of CORS (the browser only blocks *reading*
 * the response, which a fire-and-forget beacon never does).
 *
 * Fail-safe + bounded: any unparseable / oversized / wrong-typed input yields
 * `{}` (so the best-effort emit still runs, consent defaulting false), and the
 * manual length caps replace the `t.Object` maxLength this route used to carry.
 */
function parseBeaconBody(raw: unknown): StoreClickBody {
  let obj: Record<string, unknown>;
  if (typeof raw === "string") {
    if (raw.length > 4096) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      obj =
        parsed !== null && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      return {};
    }
  } else if (raw !== null && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  } else {
    return {};
  }
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined;
  return {
    fbc: str(obj.fbc, 255),
    fbp: str(obj.fbp, 255),
    event_id: str(obj.event_id, 100),
    marketing_consent: obj.marketing_consent === true ? true : undefined,
    store:
      obj.store === "ios" || obj.store === "android" ? obj.store : undefined,
    ref: str(obj.ref, 24),
    campaign:
      typeof obj.campaign === "string" && CAMPAIGN_SLUG_RE.test(obj.campaign)
        ? obj.campaign
        : undefined,
  };
}

/** Optional Meta click-capture + Turnstile fields shared by both lead routes (WS3). */
const attributionFields = {
  fbc: t.Optional(t.String({ maxLength: 255 })),
  fbp: t.Optional(t.String({ maxLength: 255 })),
  event_id: t.Optional(t.String({ maxLength: 100 })),
  // Marketing consent (spec-30 R2.7) — a boolean, not PII. Default false server-
  // side (fail closed): only an affirmative true lets the drainer forward.
  marketing_consent: t.Optional(t.Boolean()),
  turnstileToken: t.Optional(t.String({ maxLength: 2048 })),
};

/** true when the Turnstile challenge is on and the token is absent/invalid. */
function challengeRejected(outcome: string): boolean {
  return outcome === "missing_token" || outcome === "failed";
}

export const leadsRoutes = new Elysia()
  // CORS on the error path too. Schema-validation (t.Object) failures reject
  // BEFORE the handler's `withCors` runs, so a 422 would otherwise reach the
  // browser without `access-control-*` headers and be unreadable — the form
  // would show a generic failure instead of the field error. This only stamps
  // headers and does not build a body, so Elysia's normal error response (and
  // the root `coreErrorHandler` in production) still renders it; local to this
  // sub-app, so it does not touch sibling routes' error handling.
  .onError(({ set }) => {
    withCors({ set });
  })
  .post(
    "/leads/waitlist",
    async (ctx) => {
      withCors(ctx); // stamp CORS on every response, incl. the 429/4xx below.
      // Origin-backstop rate limit — first gate, before any work (see header).
      if (rateLimited(ctx.headers, "leads", LEAD_RATE_LIMIT)) {
        ctx.set.status = 429;
        return { ok: false as const, error: "rate_limited" as const };
      }

      const {
        email,
        name,
        hp,
        fbc,
        fbp,
        event_id,
        marketing_consent,
        turnstileToken,
      } = ctx.body;

      if (isHoneypotTripped(hp)) {
        return { ok: true as const };
      }

      // Bot challenge (WS3). No-op until TURNSTILE_SECRET is set — checked after
      // the honeypot so an obvious bot never burns a siteverify call.
      if (challengeRejected(await verifyTurnstile(turnstileToken))) {
        ctx.set.status = 400;
        return { ok: false as const, error: "challenge_failed" as const };
      }

      const normalizedEmail = normalizeEmail(email);
      if (!EMAIL_RE.test(normalizedEmail)) {
        ctx.set.status = 400;
        return { ok: false as const, error: "invalid_email" as const };
      }

      try {
        await addContactToAudience(getResendAthletesAudienceId(), {
          email: normalizedEmail,
          ...splitName(name),
        });
        // Best-effort funnel emit (never affects the 200/503; emitEvent
        // swallows its own errors — HC-2). Deduped with the browser pixel via
        // the shared event_id (WS3).
        await emitEvent(
          leadCapturedEvent("athletes", {
            fbc,
            fbp,
            eventId: event_id,
            marketingConsent: marketing_consent,
          }),
        );
        return { ok: true as const };
      } catch (err) {
        console.error(
          `[leads:waitlist] Resend add-contact failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        ctx.set.status = 503;
        return { ok: false as const, error: "unavailable" as const };
      }
    },
    {
      // Bounds on a PUBLIC endpoint — keep an attacker from posting oversized
      // payloads (Elysia rejects over-length with a 422 before the handler).
      body: t.Object({
        email: t.String({ maxLength: 320 }),
        name: t.Optional(t.String({ maxLength: 200 })),
        source: t.Optional(t.String({ maxLength: 60 })),
        hp: t.Optional(t.String({ maxLength: 200 })),
        ...attributionFields,
      }),
      detail: {
        description:
          "Public — add an email to the launch waitlist (ATHLETES Resend audience).",
        tags: ["Leads"],
      },
    },
  )
  .post(
    "/leads/coach",
    async (ctx) => {
      withCors(ctx); // stamp CORS on every response, incl. the 429/4xx below.
      // Origin-backstop rate limit — first gate, before any work (see header).
      if (rateLimited(ctx.headers, "leads", LEAD_RATE_LIMIT)) {
        ctx.set.status = 429;
        return { ok: false as const, error: "rate_limited" as const };
      }

      const {
        email,
        name,
        clientCount,
        currentTool,
        message,
        hp,
        fbc,
        fbp,
        event_id,
        marketing_consent,
        turnstileToken,
      } = ctx.body;

      if (isHoneypotTripped(hp)) {
        return { ok: true as const };
      }

      // Bot challenge (WS3) — the coach route is the email-amplification vector,
      // so this matters most here. No-op until TURNSTILE_SECRET is set.
      if (challengeRejected(await verifyTurnstile(turnstileToken))) {
        ctx.set.status = 400;
        return { ok: false as const, error: "challenge_failed" as const };
      }

      const normalizedEmail = normalizeEmail(email);
      if (!EMAIL_RE.test(normalizedEmail)) {
        ctx.set.status = 400;
        return { ok: false as const, error: "invalid_email" as const };
      }

      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        ctx.set.status = 400;
        return { ok: false as const, error: "invalid_name" as const };
      }

      try {
        await addContactToAudience(getResendCoachesAudienceId(), {
          email: normalizedEmail,
          ...splitName(trimmedName),
        });
      } catch (err) {
        console.error(
          `[leads:coach] Resend add-contact failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        ctx.set.status = 503;
        return { ok: false as const, error: "unavailable" as const };
      }

      // Best-effort funnel emit (never affects the 200/503; emitEvent swallows
      // its own errors — HC-2). Deduped with the browser pixel via event_id.
      await emitEvent(
        leadCapturedEvent("coaches", {
          fbc,
          fbp,
          eventId: event_id,
          marketingConsent: marketing_consent,
        }),
      );

      // Internal notification — BEST-EFFORT. The contact is already captured
      // above; a delivery failure here must not fail the request (the lead
      // would otherwise silently disappear whenever notification email
      // happens to be flaky).
      try {
        const lines = [
          `Email: ${normalizedEmail}`,
          `Name: ${trimmedName}`,
          `Client count: ${clientCount ?? "(not provided)"}`,
          `Current tool: ${currentTool ?? "(not provided)"}`,
          `Message: ${message ?? "(not provided)"}`,
        ];
        await sendEmail({
          to: RESEND_NOTIFICATION_TO,
          ...buildInternalEmail("New coach enquiry", lines.join("\n")),
        });
      } catch (err) {
        console.error(
          `[leads:coach] notification email failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      return { ok: true as const };
    },
    {
      body: t.Object({
        email: t.String({ maxLength: 320 }),
        name: t.String({ maxLength: 200 }),
        clientCount: t.Optional(t.String({ maxLength: 40 })),
        currentTool: t.Optional(t.String({ maxLength: 200 })),
        message: t.Optional(t.String({ maxLength: 4000 })),
        hp: t.Optional(t.String({ maxLength: 200 })),
        ...attributionFields,
      }),
      detail: {
        description:
          "Public — capture a coach enquiry (COACHES Resend audience) + best-effort ops notification.",
        tags: ["Leads"],
      },
    },
  )
  .post(
    "/store-click",
    async (ctx) => {
      withCors(ctx); // stamp CORS on every response, incl. the 429 below.
      // Origin-backstop rate limit — first gate, before any work (see header).
      if (rateLimited(ctx.headers, "store-click", STORE_CLICK_RATE_LIMIT)) {
        ctx.set.status = 429;
        return { ok: false as const, error: "rate_limited" as const };
      }

      // No `body` schema: the production beacon is `text/plain` (so sendBeacon
      // delivers cross-origin — see parseBeaconBody), which a `t.Object` JSON
      // schema would 422. parseBeaconBody accepts text/plain OR json and bounds.
      const { fbc, fbp, event_id, marketing_consent, store, ref, campaign } =
        parseBeaconBody(ctx.body);
      // Best-effort conversion emit (spec-30 R3.8). Public + anonymous, no email
      // — so no honeypot / Turnstile (it is not an email-amplification vector).
      // Deduped with the browser pixel's `AppStoreClick` via the shared
      // event_id; the CAPI drainer consent-gates on `marketing_consent` (R2.7).
      await emitEvent(
        storeClickEvent({
          fbc,
          fbp,
          eventId: event_id,
          marketingConsent: marketing_consent,
          store,
          ref,
          campaign,
        }),
      );
      return { ok: true as const };
    },
    {
      detail: {
        description:
          "Public — record an outbound app-store click conversion (spec-30 R3.8).",
        tags: ["Leads"],
      },
    },
  )
  // CORS preflight for the leads `fetch` calls (a POST + application/json is not
  // a simple request). `/store-click` uses a simple text/plain beacon and never
  // preflights, but it gets an OPTIONS handler too for symmetry / any future
  // json caller. These are cheap 204s and are never rate-limited.
  .options("/leads/waitlist", () => preflightResponse())
  .options("/leads/coach", () => preflightResponse())
  .options("/store-click", () => preflightResponse());

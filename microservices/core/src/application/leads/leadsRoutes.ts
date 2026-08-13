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
 * ⚠ FOLLOW-UP before the forms / App Store CTA are publicly linked: ALL THREE
 * public endpoints here (`/leads/waitlist`, `/leads/coach`, `/store-click`) have
 * NO rate limiting beyond the honeypot (and `/store-click` has no honeypot — a
 * click beacon can't carry one). Unthrottled they are abuse vectors:
 *   - `/leads/coach` fires an internal notification email per accepted request
 *     (email-amplification + Resend-quota abuse);
 *   - `/store-click` writes an `analytics_events` row per request (table
 *     inflation — the 7-day age-out only stamps, it doesn't delete) and, worse,
 *     a script posting `{marketing_consent:true, fbp:…}` can forge `AppStoreClick`
 *     conversions and pollute the very ad-optimisation signal this exists for.
 * Add an AWS WAF rate-based rule (or a per-IP API-Gateway throttle) covering all
 * three routes before the store CTA goes live. Bounded input (maxLength below)
 * + the honeypot are only a first line. The store CTA is NOT live yet
 * (`config.appStore.url` is null), so nothing drives `/store-click` publicly
 * today — this gate activates when Brad flips the CTA on.
 */

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
  return {
    name: "store_click",
    source: "web",
    eventId: attribution.eventId,
    properties,
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
  .post(
    "/leads/waitlist",
    async (ctx) => {
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
          subject: "New coach enquiry",
          text: lines.join("\n"),
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
      const { fbc, fbp, event_id, marketing_consent } = ctx.body;
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
        }),
      );
      return { ok: true as const };
    },
    {
      body: t.Object({
        fbc: t.Optional(t.String({ maxLength: 255 })),
        fbp: t.Optional(t.String({ maxLength: 255 })),
        event_id: t.Optional(t.String({ maxLength: 100 })),
        marketing_consent: t.Optional(t.Boolean()),
      }),
      detail: {
        description:
          "Public — record an outbound App Store click conversion (spec-30 R3.8).",
        tags: ["Leads"],
      },
    },
  );

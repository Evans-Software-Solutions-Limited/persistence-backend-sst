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
 * Marketing lead capture — PUBLIC (no auth) endpoints backing the website's
 * waitlist + coach-enquiry forms. Grouped into ONE sub-app so it can be
 * mounted with a single `.use()`, mirroring `jobsRoutes` /
 * `trainersOnBehalfRoutes`.
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
 * ⚠ FOLLOW-UP before the forms are publicly linked: these public endpoints
 * have NO rate limiting beyond the honeypot. `/leads/coach` fires an internal
 * notification email per accepted request, so an unthrottled script is an
 * email-amplification + Resend-quota abuse vector. Add a per-IP throttle
 * (API Gateway route throttle) or a Turnstile/CAPTCHA challenge on the forms.
 * Bounded input (maxLength below) and the honeypot are only a first line.
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

/**
 * Build the best-effort `lead_captured` event (spec-30 R1.4 / R3.2).
 *
 * `fbc`/`fbp` are Meta click identifiers and `event_id` is the pixel dedup key —
 * NOT PII (no email/name), so they are safe to persist in `properties` for the
 * CAPI drainer to forward and dedup the server `Lead` against the browser pixel.
 */
function leadCapturedEvent(
  audience: "athletes" | "coaches",
  attribution: { fbc?: string; fbp?: string; eventId?: string },
): AnalyticsEventInput {
  const properties: Record<string, unknown> = { audience };
  if (attribution.fbc) properties.fbc = attribution.fbc;
  if (attribution.fbp) properties.fbp = attribution.fbp;
  return {
    name: "lead_captured",
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
      const { email, name, hp, fbc, fbp, event_id, turnstileToken } = ctx.body;

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
          leadCapturedEvent("athletes", { fbc, fbp, eventId: event_id }),
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
        leadCapturedEvent("coaches", { fbc, fbp, eventId: event_id }),
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
  );

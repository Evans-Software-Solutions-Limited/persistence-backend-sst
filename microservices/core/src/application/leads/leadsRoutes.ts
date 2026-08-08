import Elysia, { t } from "elysia";
import {
  addContactToAudience,
  getResendAthletesAudienceId,
  getResendCoachesAudienceId,
  RESEND_NOTIFICATION_TO,
  sendEmail,
} from "./resendClient";

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

export const leadsRoutes = new Elysia()
  .post(
    "/leads/waitlist",
    async (ctx) => {
      const { email, name, hp } = ctx.body;

      if (isHoneypotTripped(hp)) {
        return { ok: true as const };
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
      const { email, name, clientCount, currentTool, message, hp } = ctx.body;

      if (isHoneypotTripped(hp)) {
        return { ok: true as const };
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
      }),
      detail: {
        description:
          "Public — capture a coach enquiry (COACHES Resend audience) + best-effort ops notification.",
        tags: ["Leads"],
      },
    },
  );

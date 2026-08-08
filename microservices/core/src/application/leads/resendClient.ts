import { getEnv } from "@persistence/api-utils/env";

/**
 * Resend REST client for marketing lead capture (waitlist + coach enquiry).
 * Server-only — the secret API key never reaches the client. Native `fetch`
 * (Lambda Node runtime), no SDK dependency, matching the codebase's
 * outbound-HTTP convention (see `revenuecat/revenueCatClient.ts`).
 *
 * There is no database for leads — Resend Audiences ARE the store. Contacts
 * are added directly via the REST API; the coach path additionally sends a
 * best-effort internal notification email.
 */

const RESEND_API_BASE = "https://api.resend.com";

export const RESEND_FROM =
  "Persistence <no-reply@evans-software-solutions.com>";
export const RESEND_NOTIFICATION_TO = "admin@evans-software-solutions.com";

export function getResendApiKey(): string {
  return getEnv("RESEND_API_KEY");
}

export function getResendAthletesAudienceId(): string {
  return getEnv("RESEND_ATHLETES_AUDIENCE_ID");
}

export function getResendCoachesAudienceId(): string {
  return getEnv("RESEND_COACHES_AUDIENCE_ID");
}

/**
 * Thrown when Resend isn't configured for this stage (empty API key or
 * audience id) — deploys must not fail-fast on missing config (mirrors
 * `ExpoAccessToken` / `SentryDsn`, not the fail-fast secrets). Routes catch
 * this and return 503, rather than 500ing on every lead submission until
 * Brad sets the secrets.
 */
export class ResendNotConfiguredError extends Error {
  constructor(message = "Resend is not configured") {
    super(message);
    this.name = "ResendNotConfiguredError";
  }
}

function requireConfigured(apiKey: string, audienceId: string): void {
  if (apiKey.length === 0 || audienceId.length === 0) {
    throw new ResendNotConfiguredError();
  }
}

export interface AddContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Add (or idempotently re-add) a contact to a Resend audience.
 *
 * `POST /audiences/{audienceId}/contacts`. Treats a duplicate-contact
 * response as success — Resend can answer either with HTTP 409, or with a
 * 422 whose body message mentions "already"/"exists" — so a second signup
 * from the same address doesn't surface as an error to the caller.
 *
 * Throws (a plain `Error`, or `ResendNotConfiguredError` if the API key /
 * audience id is empty) on any other non-2xx response, so callers can map
 * failures to a 503 without silently dropping a lead.
 */
export async function addContactToAudience(
  audienceId: string,
  input: AddContactInput,
): Promise<void> {
  const apiKey = getResendApiKey();
  requireConfigured(apiKey, audienceId);

  const res = await fetch(
    `${RESEND_API_BASE}/audiences/${encodeURIComponent(audienceId)}/contacts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        ...(input.firstName !== undefined
          ? { first_name: input.firstName }
          : {}),
        ...(input.lastName !== undefined ? { last_name: input.lastName } : {}),
        unsubscribed: false,
      }),
    },
  );

  if (res.ok) return;

  if (res.status === 409) return; // duplicate contact — idempotent success

  if (res.status === 422) {
    const bodyText = await res.text().catch(() => "");
    if (/already|exists/i.test(bodyText)) return; // duplicate contact
    // Do NOT include `bodyText` in the thrown message: Resend's 422 body can
    // echo the submitted address, and this message is logged by the route —
    // which would land submitter PII in CloudWatch (UK-GDPR retention).
    throw new Error("Resend add-contact failed: 422 (validation)");
  }

  throw new Error(`Resend add-contact failed: ${res.status} ${res.statusText}`);
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

/**
 * Send a transactional/notification email via `POST /emails`. Used only for
 * the coach-enquiry internal notification — callers wrap this in their own
 * try/catch (best-effort; a delivery failure must not fail the lead-capture
 * request, since the contact is already in the audience).
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = getResendApiKey();
  if (apiKey.length === 0) {
    throw new ResendNotConfiguredError();
  }

  const res = await fetch(`${RESEND_API_BASE}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Resend send-email failed: ${res.status} ${res.statusText}`,
    );
  }
}

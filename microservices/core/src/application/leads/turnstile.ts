import { getEnvOrDefault } from "@persistence/api-utils/env";

/**
 * Cloudflare Turnstile verification for the public `/leads/*` forms (spec-30
 * WS3, R3.3). OPTIONAL + fail-safe, mirroring `resendClient`: with
 * `TURNSTILE_SECRET` unset, verification is SKIPPED so the forms behave exactly
 * as before this shipped. Once the secret is set (before the forms are publicly
 * linked / ad traffic is driven), a submission without a valid token is rejected.
 *
 * Native `fetch`, no SDK.
 */

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function getTurnstileSecret(): string {
  return getEnvOrDefault("TURNSTILE_SECRET", "");
}

export function isTurnstileConfigured(): boolean {
  return getTurnstileSecret().length > 0;
}

export type TurnstileOutcome =
  | "skipped" // not configured — allow (fail-safe)
  | "passed"
  | "missing_token"
  | "failed";

/**
 * Verify a Turnstile token. Returns `"skipped"` when unconfigured (allow).
 * When configured: `"missing_token"` if the client sent none, `"failed"` if
 * Cloudflare rejects it (or the verify call itself errors — fail CLOSED once
 * the challenge is switched on), `"passed"` otherwise. Never throws.
 */
export async function verifyTurnstile(
  token: string | undefined,
): Promise<TurnstileOutcome> {
  const secret = getTurnstileSecret();
  if (secret.length === 0) return "skipped";
  if (token === undefined || token.length === 0) return "missing_token";

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }).toString(),
    });
    if (!res.ok) return "failed";
    const body = (await res.json()) as { success?: unknown };
    return body.success === true ? "passed" : "failed";
  } catch {
    // Once the challenge is on, a verify outage fails closed rather than waving
    // traffic through — the whole point is to gate the public forms.
    return "failed";
  }
}

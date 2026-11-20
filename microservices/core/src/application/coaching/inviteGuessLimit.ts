import { rateLimitExceeded } from "../leads/rateLimit";

/**
 * Throttle on guessing invite codes (PER-108; Inspector Brad, #540).
 *
 * Codes are 6 characters from a 32-letter alphabet. A personal code activates
 * a relationship straight away and hands over the coach's set-up, so a guessed
 * one is worth more than a general code, which only makes a pending request.
 * `GET /invites/:code/preview` and `POST /trainers/accept-invite-code` both
 * tell a valid code from an invalid one, so they share ONE budget: using
 * both routes doesn't double an attacker's attempts. A real athlete needs
 * about two (preview, then accept).
 *
 *   - per user: stops one account sweeping codes;
 *   - per IP:   stops one caller spreading the sweep over many accounts.
 *     It's higher, because a gym or office can share an address. Keyed on
 *     the TRUSTED `x-persistence-source-ip` header, which `api.ts` sets from
 *     API Gateway's `requestContext` after stripping any client-sent copy.
 *     Never `X-Forwarded-For`: its first entry is whatever the caller sent,
 *     so a fresh value per request would dodge the cap (and grow the bucket
 *     map until it clears every window).
 *
 * ⚠ In-memory, so per Lambda container, like `leads/rateLimit.ts`: a first
 * line, not a wall. A durable limiter needs a table (see together's
 * rate-limit store) or a WAF rule in front of the API.
 */
export const INVITE_GUESS_LIMIT_PER_USER = 30;
export const INVITE_GUESS_LIMIT_PER_IP = 120;
export const INVITE_GUESS_WINDOW_MS = 60 * 60 * 1000;

/** The header `trustedSourceHeaders` sets; read it, never `X-Forwarded-For`. */
export const TRUSTED_SOURCE_IP_HEADER = "x-persistence-source-ip";

export function inviteGuessLimited(
  userId: string,
  sourceIp: string | undefined,
): boolean {
  // Record both hits before deciding, so neither bucket is skipped.
  const byUser = rateLimitExceeded(
    `invite-guess:user:${userId}`,
    INVITE_GUESS_LIMIT_PER_USER,
    INVITE_GUESS_WINDOW_MS,
  );
  const byIp = rateLimitExceeded(
    `invite-guess:ip:${sourceIp ?? "unknown"}`,
    INVITE_GUESS_LIMIT_PER_IP,
    INVITE_GUESS_WINDOW_MS,
  );
  return byUser || byIp;
}

export const RATE_LIMITED_BODY = {
  code: "rate_limited",
  message: "Too many attempts. Try again later.",
} as const;

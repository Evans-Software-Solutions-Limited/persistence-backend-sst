/**
 * Read and validate the client-supplied `Idempotency-Key` header.
 *
 * The mobile sync queue stamps one key per logical mutation at enqueue time and
 * resends it on every attempt, so a create that is retried after an AMBIGUOUS
 * failure (a timeout or connection reset that happened after the server
 * committed) resolves to the row the first attempt created instead of inserting a
 * duplicate.
 *
 * Returns `null` when the header is absent, blank, or not a usable key — in which
 * case the create behaves exactly as it did before this existed. Never throws: a
 * malformed key is a reason to fall back to non-idempotent behaviour, not a reason
 * to reject a write the user is waiting on.
 */

/**
 * Upper bound on a stored key. The mobile generator produces roughly 40–60 chars
 * (`<entityId>-<epochMs>-<suffix>`); 200 leaves generous headroom while stopping
 * an arbitrary-length header from being persisted and indexed.
 */
const MAX_KEY_LENGTH = 200;

/**
 * Conservative charset: the values we mint are ids, digits and hyphens. Rejecting
 * anything else keeps a hostile header out of a unique index without needing to
 * reason about collation or normalisation.
 */
const KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

export function readIdempotencyKey(
  headers: Record<string, string | undefined>,
): string | null {
  // Elysia lowercases incoming header names; check both for direct-API callers
  // and tests that construct the object by hand.
  const raw = headers["idempotency-key"] ?? headers["Idempotency-Key"];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_KEY_LENGTH) return null;
  if (!KEY_PATTERN.test(trimmed)) return null;
  return trimmed;
}

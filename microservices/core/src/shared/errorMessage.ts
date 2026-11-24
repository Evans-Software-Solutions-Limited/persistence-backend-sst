/**
 * A readable message for any thrown value.
 *
 * `String(err)` turns a plain object (Stripe and AWS SDKs can reject with
 * non-`Error` objects) into "[object Object]", which hides the reason in logs
 * and defeats message checks such as "already cancelled". This prefers an
 * `Error`'s message, then an object's own string `message`, then its JSON.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(err);
    } catch {
      // Circular structures and BigInt values cannot be serialised.
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

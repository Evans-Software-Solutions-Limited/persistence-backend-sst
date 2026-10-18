/**
 * The machine code of a failure. Expo delivers a native `promise.reject(code,
 * description)` as an Error whose `code` is ours and whose `message` is the
 * human description, so reading only `message` turns `connect_failed` into
 * "Nearby connection failed" and every connect-stage failure into the same
 * generic copy (the 17 Oct two-iPhone Nearby run).
 */
export function togetherErrorCode(error: unknown, fallback = "unavailable") {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    if (error instanceof Error && error.message) return error.message;
  }
  // Anything else (a thrown string, undefined) is not a code we can act on.
  return fallback;
}

export function togetherErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message || undefined;
  if (typeof error === "string") return error;
  return undefined;
}

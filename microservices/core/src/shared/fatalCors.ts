import { adminCorsHeaders } from "../application/admin/adminCors";

/**
 * The admin CORS headers for a request that never reached Elysia.
 *
 * Reads the raw Lambda event rather than a parsed request, because by
 * definition nothing parsed it. Defensive throughout: this runs on the path
 * where something has already gone wrong, so a missing field must not turn a
 * 500 into a crash.
 */
export function fatalCorsHeaders(event: unknown): Record<string, string> {
  try {
    const e = event as {
      rawPath?: string;
      headers?: Record<string, string | undefined>;
    };
    const path = e.rawPath ?? "";
    if (!(path === "/admin" || path.startsWith("/admin/"))) return {};
    // Header names arrive lower-cased on API Gateway v2 payloads, but do not
    // rely on it.
    const headers = e.headers ?? {};
    const origin =
      headers.origin ??
      headers.Origin ??
      Object.entries(headers).find(([k]) => k.toLowerCase() === "origin")?.[1];
    return adminCorsHeaders(origin ?? undefined);
  } catch {
    return {};
  }
}

import Elysia from "elysia";
import { webOrigin } from "../../shared/webOrigin";

/**
 * CORS for `/admin/*`.
 *
 * ─── Why this is needed at all ───
 *
 * The admin panel is served from the website's origin and calls the API on
 * `api.<host>`, so every request is cross-origin. `adminFetch` sends both
 * `Authorization: Bearer …` and `Content-Type: application/json`, and either
 * one alone makes the request non-simple — so the browser sends a `OPTIONS`
 * preflight first, on EVERY admin call, including GETs. Nothing answered that
 * preflight, so the panel could not reach a single admin endpoint. The CSP in
 * `infra/web.ts` already permits the connection; CSP is the browser asking
 * whether the PAGE may call out, CORS is the server saying whether the API
 * will be read. Both are required and only one was in place.
 *
 * ─── Why the origin is echoed rather than `*` ───
 *
 * `/leads` and `/founding/checkout` use `*` because they are genuinely public
 * and anonymous. These routes are not: they read and write every user's
 * account. `*` would let any page on the internet issue admin calls from a
 * visitor's browser — harmless while the credential is a bearer token a script
 * on another origin cannot read, but a single change to cookie auth would turn
 * it into full account takeover, silently. Allowing exactly one origin costs
 * nothing and removes that.
 *
 * `Vary: Origin` because the response now differs by request origin, and a
 * shared cache that missed that could hand one origin another's allow header.
 *
 * No `Access-Control-Allow-Credentials`: the token travels in a header, not a
 * cookie, so the browser never needs to attach ambient credentials — and not
 * setting it keeps the door shut if auth ever moves to cookies.
 */
const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = "authorization, content-type";

/** True when `origin` is the one host allowed to drive the admin API. */
export function isAllowedAdminOrigin(origin: string | undefined): boolean {
  return typeof origin === "string" && origin === webOrigin();
}

export function adminCorsHeaders(
  origin: string | undefined,
): Record<string, string> {
  // `Vary` is returned whether or not the origin matched: the decision depends
  // on the header either way, so a cache must key on it either way.
  const headers: Record<string, string> = { vary: "Origin" };
  if (!isAllowedAdminOrigin(origin)) return headers;
  return {
    ...headers,
    "access-control-allow-origin": origin as string,
    "access-control-allow-methods": ALLOWED_METHODS,
    "access-control-allow-headers": ALLOWED_HEADERS,
    "access-control-max-age": "86400",
  };
}

/**
 * Mounted first in `adminRoutes`.
 *
 * The preflight is answered in `onRequest`, which runs BEFORE routing and
 * before `adminGuard`'s `derive`. That ordering is the point: a preflight
 * carries no `Authorization` header, so letting it reach the guard would
 * answer a browser's "may I?" with 401 — and a browser reports that as a CORS
 * failure, not as a sign-in problem.
 *
 * `onError` is `as: "global"` for the same reason: a 401 or 403 without these
 * headers is unreadable to the page, so a signed-out admin would see "CORS
 * error" instead of "Signed out" and `adminFetch`'s own 401 handling — which
 * clears the stored session — would never run.
 *
 * `/admin`-only, checked on the PATH rather than trusted to plugin scoping.
 *
 * `onRequest` runs before routing, so it has no route to be scoped to and
 * Elysia offers it no `as:` option. Once this plugin is merged into the root
 * chain its hook therefore sees every request the API serves — including the
 * mobile app's. Gating on the path is what keeps this policy off routes that
 * have their own (`/leads` and `/founding/*` are deliberately `*`), and stops
 * it answering their preflights with an admin allow-list.
 */
function isAdminPath(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith("/admin");
  } catch {
    // A URL Elysia could parse but `URL` cannot is not an admin route.
    return false;
  }
}

export const adminCors = new Elysia({ name: "admin-cors" })
  .onRequest(({ request, set }) => {
    if (!isAdminPath(request.url)) return;
    const origin = request.headers.get("origin") ?? undefined;
    const headers = adminCorsHeaders(origin);
    if (request.method === "OPTIONS") {
      // 204: a preflight has no body, and answering it here means it never
      // reaches the guard — which would 401 it for having no bearer token.
      return new Response(null, { status: 204, headers });
    }
    Object.assign(set.headers, headers);
  })
  .onError({ as: "global" }, ({ request, set }) => {
    if (!isAdminPath(request.url)) return;
    Object.assign(
      set.headers,
      adminCorsHeaders(request.headers.get("origin") ?? undefined),
    );
  });

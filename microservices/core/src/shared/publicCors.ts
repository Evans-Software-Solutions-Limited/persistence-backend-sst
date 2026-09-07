/**
 * CORS for routes that are genuinely public and anonymous.
 *
 * `*`, deliberately: these carry no credential, so there is no session for
 * another origin to ride. Contrast `admin/adminCors.ts`, which echoes exactly
 * one origin because those routes read and write every user's account.
 *
 * ─── Why every browser-facing route needs this ───
 *
 * `infra/api.ts` sets `cors: false` on the gateway, so API Gateway neither
 * answers preflights nor injects headers — the Lambda owns all of it. A GET
 * with no custom headers is a "simple" request and is never preflighted, but
 * the browser still refuses to let the page READ the response unless
 * `Access-Control-Allow-Origin` is on it. So a public GET needs these headers
 * even though it needs no `OPTIONS` route.
 *
 * `leadsRoutes` and `foundingCheckoutHandler` predate this module and keep
 * their own equivalent copies; they should migrate here when next touched.
 */
export function publicCorsHeaders(methods: string): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": methods,
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

/** Read-only public data: a GET, plus the OPTIONS a cautious client may send. */
export const PUBLIC_READ_METHODS = "GET, OPTIONS";

export function withPublicCors(
  ctx: { set: { headers: Record<string, string | number> } },
  methods: string = PUBLIC_READ_METHODS,
): void {
  Object.assign(ctx.set.headers, publicCorsHeaders(methods));
}

/** A preflight answer for a public route: no body, headers only. */
export function publicPreflight(
  methods: string = PUBLIC_READ_METHODS,
): Response {
  return new Response(null, {
    status: 204,
    headers: publicCorsHeaders(methods),
  });
}

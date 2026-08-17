import {
  ANDROID_UA_PATTERN,
  BOT_UA_PATTERN,
  EDGE_REDIRECT_PREFIX,
  IOS_UA_PATTERN,
  buildRedirectTable,
} from "./edgeRedirect";

/**
 * Generates the CloudFront Function body for the `/g/*` behaviours in
 * `infra/web.ts`, at SYNTH time.
 *
 * ─── Why generated, not written ───
 *
 * The `ct` a QR scan produces must equal the `ct` the web CTA produces for the
 * same slug. A CloudFront Function runs `cloudfront-js-2.0`: no ES modules, no
 * `require`, no network, so it cannot import `CAMPAIGNS` at runtime. Retyping
 * the slugs into a string literal is exactly how the two would drift, and a
 * printed QR is fixed for the life of the print run. So the campaign table is
 * resolved by {@link buildRedirectTable} and serialised into the body as a JSON
 * literal, and the user-agent patterns are interpolated from the same constants
 * the unit tests match on.
 *
 * ─── The duplication that remains, and what pins it ───
 *
 * The branch order below restates `resolveRedirect`'s logic in the edge
 * runtime's dialect (`var`, no optional chaining). That duplication is
 * unavoidable — the browser CSP forbids `unsafe-eval`, so the site cannot share
 * one implementation by evaluating this string. What makes it safe is
 * `__tests__/edgeRedirect.test.ts`, which EXECUTES this generated source and
 * asserts it agrees with `resolveRedirect` on every user-agent × path pair. A
 * divergence fails `bun run test:unit`, not a leaflet.
 *
 * This module is imported only by `infra/web.ts`; nothing in the browser bundle
 * references it.
 */

/**
 * CloudFront's hard ceiling on function source (10 KB). Asserted at synth
 * because `infra/` has no tests: exceeding it would otherwise surface as an
 * opaque deploy failure. Today's body is ~2 KB, so this is headroom for ~40
 * more campaigns.
 */
export const EDGE_FUNCTION_MAX_BYTES = 10 * 1024;

/**
 * Throws if `source` would be rejected by CloudFront. Separate from the builder
 * so the guard itself is testable — the only other way to exercise it would be
 * to add forty campaigns.
 */
export function assertWithinFunctionSizeLimit(source: string): string {
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > EDGE_FUNCTION_MAX_BYTES) {
    throw new Error(
      `Campaign redirect CloudFront Function is ${bytes} bytes, over CloudFront's ${EDGE_FUNCTION_MAX_BYTES}-byte limit. Shorten the table or move the lookup to a KeyValueStore.`,
    );
  }
  return source;
}

export function buildEdgeFunctionSource(): string {
  const table = JSON.stringify(buildRedirectTable());

  // `dest` rather than `location`, and `var` throughout: cloudfront-js-2.0 is
  // ES5.1 plus selected later features, and shadowing a familiar global name in
  // a runtime with no debugger is not worth the saved keystroke.
  const source = `function handler(event) {
  var T = ${table};

  var ua = "";
  var uaHeader = event.request.headers["user-agent"];
  if (uaHeader && uaHeader.value) ua = uaHeader.value;

  // An explicit predicate, NOT filter(Boolean): \`Boolean\` is absent from this
  // runtime's documented globals, and an unbound global would be a 502 on every
  // scan — in a directory with no typecheck and no tests.
  var parts = event.request.uri.toLowerCase().split("/").filter(function (s) {
    return s !== "";
  });
  var slug = "";
  if (parts.length > 1 && parts[0] === ${JSON.stringify(EDGE_REDIRECT_PREFIX)}) {
    slug = parts[1];
    try { slug = decodeURIComponent(slug); } catch (e) {}
    // Again after decoding: "%46" decodes to an upper-case "F".
    slug = slug.toLowerCase();
  }

  var entry = Object.prototype.hasOwnProperty.call(T.slugs, slug)
    ? T.slugs[slug]
    : null;
  var dest = entry ? entry.landing : T.fallbackLanding;

  if (/${BOT_UA_PATTERN}/i.test(ua)) {
    // Crawler or link unfurler: landing page, already set.
  } else if (entry && entry.ios && /${IOS_UA_PATTERN}/i.test(ua)) {
    dest = entry.ios;
  } else if (entry && entry.android && /${ANDROID_UA_PATTERN}/i.test(ua)) {
    dest = entry.android;
  }

  // Forward the query string onto a LANDING destination so Meta's fbclid
  // survives the hop and the pixel can seed _fbc. Never onto the store URL:
  // Apple reads only pt/ct/mt. \`event.request.uri\` excludes the query string,
  // so it has to be rebuilt from \`querystring\`.
  if (dest.charAt(0) === "/") {
    var query = "";
    for (var key in event.request.querystring) {
      query += (query === "" ? "" : "&") + key + "=" + event.request.querystring[key].value;
    }
    // Always "?": every landing path is "/<slug>" or "/", never one with a query
    // of its own (asserted in edgeRedirect.test.ts).
    if (query !== "") dest = dest + "?" + query;
  }

  return {
    statusCode: 302,
    statusDescription: "Found",
    headers: {
      "location": { "value": dest },
      // The response varies by user-agent. CloudFront never caches a
      // viewer-request-generated response, but a browser or a corporate proxy
      // will happily cache a 302 without this.
      "cache-control": { "value": "no-store" }
    }
  };
}`;

  return assertWithinFunctionSizeLimit(source);
}

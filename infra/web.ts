import { coreAPI } from "./api";
import { marketingEdge } from "./web-edge";
import { webDomain, hostedZoneId, supabaseUrl } from "./domains";
import { EDGE_REDIRECT_PREFIX } from "../packages/web/src/marketing/edgeRedirect";
import { buildEdgeFunctionSource } from "../packages/web/src/marketing/edgeRedirectSource";
import { webConnectSrcOrigins } from "../packages/web/src/security/webContentSecurityPolicy";

const region = aws.getRegionOutput().name;

// The WAF-fronted marketing edge the website routes its anonymous /leads +
// /store-click POSTs through (spec-30 R3.3; see infra/web-edge.ts). `undefined`
// on dev stages, where the website falls back to the direct Core API URL — so
// this is `""` there, both for the CSP token and the build var below.
const marketingEdgeOrigin = marketingEdge ? marketingEdge.url : "";
const webConnectSrc = webConnectSrcOrigins(supabaseUrl).join(" ");

// Security response headers for the static site. A CloudFront
// ResponseHeadersPolicy is the AWS-native way to attach these — no per-request
// function cost, and no external CDN (e.g. Cloudflare) needed: CloudFront +
// ACM + AWS Shield Standard already give us the CDN, TLS and L3/4 DDoS cover
// Cloudflare would sell. The missing piece was the headers below.
//
// The CSP is scoped to the origins the app actually talks to: same-origin
// assets, the Core API (data + auth), and Apple's iTunes lookup (used by the
// optional App Store rating badge in the marketing config). `style-src` allows
// 'unsafe-inline' because the SPA sets inline style attributes; `img-src`
// allows https: for remote/OG images. Verify the authenticated web pages
// (/login, /auth/callback, org admin) on staging before relying on the CSP —
// loosening a directive here is a one-line change.
const securityHeaders = new aws.cloudfront.ResponseHeadersPolicy(
  "webSecurityHeaders",
  {
    securityHeadersConfig: {
      strictTransportSecurity: {
        accessControlMaxAgeSec: 31536000, // 1 year
        includeSubdomains: true,
        preload: false,
        override: true,
      },
      contentTypeOptions: { override: true },
      frameOptions: { frameOption: "DENY", override: true },
      referrerPolicy: {
        referrerPolicy: "strict-origin-when-cross-origin",
        override: true,
      },
      contentSecurityPolicy: {
        override: true,
        // spec-30 WS3 additions:
        //  - Meta Pixel: `script-src` loads fbevents.js from connect.facebook.net;
        //    `connect-src` covers the /tr beacon on www.facebook.com. `img-src`
        //    already allows `https:`, covering the pixel's tracking GIF.
        //  - Cloudflare Turnstile: `script-src` loads api.js and `frame-src`
        //    allows the challenge iframe, both from challenges.cloudflare.com.
        //    (There was no `frame-src` before; without it the iframe would fall
        //    back to `default-src 'self'` and be blocked.)
        // `${marketingEdgeOrigin}` adds the marketing-edge CloudFront origin to
        // connect-src on named stages (the website POSTs /leads + /store-click
        // there); it is `""` on dev, leaving connect-src as it was.
        contentSecurityPolicy: $interpolate`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; frame-src https://challenges.cloudflare.com; script-src 'self' https://connect.facebook.net https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src ${webConnectSrc} ${coreAPI.url} ${marketingEdgeOrigin}; form-action 'self'; upgrade-insecure-requests`,
      },
    },
    customHeadersConfig: {
      items: [
        {
          header: "permissions-policy",
          value:
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
          override: true,
        },
      ],
    },
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// `/g/:slug` — the device-aware redirect a printed QR code resolves to.
//
// iPhone → the App Store with this campaign's `pt`/`ct`/`mt`; everyone else
// (Android, desktop, bots) → the campaign's landing page on this site, which
// decorates its own CTAs with the same `ct` and fires the Meta pixel. All the
// decisions, and the tests that pin them, live in
// `packages/web/src/marketing/edgeRedirect.ts`; this block is only the wiring.
//
// ─── Why a CloudFront Function, and why its OWN behaviour ───
//
// There is no server: `packages/web` is a StaticSite (S3 behind CloudFront), so
// this cannot be a route. Rejected alternatives: Lambda@Edge (us-east-1 only,
// per-invocation cost, and a cold start on top of a QR scan over conference
// wifi), S3 website routing rules (cannot see the user-agent at all), and a
// client-side React route (a scanner on bad wifi would download the whole JS
// bundle and wait for hydration before anything happened).
//
// A CloudFront behaviour may carry at most ONE viewer-request function, and
// SST's StaticSite already puts its own on the default behaviour — that is the
// SPA/KV router the warning further down refers to. So this gets ordered
// behaviours of its own rather than being merged into SST's function, which also
// keeps the blast radius off `/`, `/privacy`, `/pricing` and every asset: a fault
// here can only ever affect `/g/*`.
//
// FOUR patterns, not one. `/g/*` does not match a bare `/g`, and CloudFront path
// patterns are CASE-SENSITIVE, so `/G/flyer` would not match either — anything
// that misses every pattern falls through to the default behaviour, is served
// index.html, matches no React route and renders a blank page. On printed
// artwork that is unrecoverable, so all four are bound. The function answers
// every request under them, so the origin is never reached; a behaviour still
// requires an origin, hence `targetOriginId`.
const campaignRedirectFunction = new aws.cloudfront.Function(
  "webCampaignRedirect",
  {
    runtime: "cloudfront-js-2.0",
    comment:
      "302 /g/<slug> to the App Store (iOS) or the campaign landing page",
    // Generated at synth time from CAMPAIGNS — the restricted `cloudfront-js-2.0`
    // runtime has no modules, and a hand-retyped slug table is exactly how the
    // `ct` on a printed QR would drift from the `ct` on the web CTA, splitting
    // one campaign across two tokens in App Analytics.
    code: buildEdgeFunctionSource(),
  },
);

// CloudFront's managed CachingDisabled policy (minTTL/defaultTTL/maxTTL all 0),
// the same one infra/web-edge.ts uses. The response varies by user-agent;
// CloudFront never caches a viewer-request-generated response, and the function
// also sets `cache-control: no-store` for browsers and corporate proxies.
const CACHE_POLICY_CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";

// SST gives the StaticSite distribution exactly one origin, with this id (see
// `createDistribution` in .sst/platform/.../static-site.ts). Never contacted on
// these behaviours — if SST ever renames it, CloudFront rejects the deploy,
// which is the intended failure mode for a directory with no typecheck.
const SST_STATIC_SITE_ORIGIN_ID = "default";

const campaignRedirectBehaviors = [
  EDGE_REDIRECT_PREFIX,
  EDGE_REDIRECT_PREFIX.toUpperCase(),
]
  .flatMap((prefix) => [`/${prefix}`, `/${prefix}/*`])
  .map((pathPattern) => ({
    pathPattern,
    targetOriginId: SST_STATIC_SITE_ORIGIN_ID,
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD"],
    cachedMethods: ["GET", "HEAD"],
    compress: false, // a 302 with no body
    cachePolicyId: CACHE_POLICY_CACHING_DISABLED,
    responseHeadersPolicyId: securityHeaders.id,
    functionAssociations: [
      {
        eventType: "viewer-request",
        functionArn: campaignRedirectFunction.arn,
      },
    ],
  }));

// Custom domain only on stable named stages (production / staging); personal
// dev stages fall back to the auto-generated CloudFront URL. `dns: sst.aws.dns
// ({ zone: hostedZoneId })` is passed explicitly for the same reasons as the
// API (see infra/api.ts): staging's zone lives in a different AWS account than
// the parent, so SST can't auto-walk to it; and even on production the explicit
// zone id narrows the IAM surface. The web host sits alongside the `api.` host:
// production `persistence.evans-software-solutions.com` (a subdomain record in
// the parent evans-software-solutions.com zone) and staging
// `staging.persistence.evans-software-solutions.com` (the apex of the delegated
// staging zone). This is the URL App Store Connect points at for the privacy
// policy (/privacy) + terms (/terms) — SST serves the SPA's index.html for
// those client-side routes, so the deep links resolve.
export const frontend = new sst.aws.StaticSite("web", {
  path: "packages/web",
  build: {
    output: "dist",
    command: "bun run build",
  },
  domain:
    webDomain != null && hostedZoneId
      ? {
          name: webDomain,
          dns: sst.aws.dns({ zone: hostedZoneId }),
        }
      : undefined,
  // Purge the CloudFront edge caches on every deploy so a new build is live
  // immediately — without this, CloudFront keeps serving the previously-cached
  // index.html until its TTL expires, which is why a fresh deploy only showed
  // up after a manual hard-reload. `wait: true` holds the deploy open until the
  // invalidation completes, so `sst deploy` finishing means the site is live.
  // (SST already stamps hashed assets immutable and index.html no-cache; the
  // missing piece was the edge invalidation.)
  //
  // ⚠ This invalidation was NECESSARY but not SUFFICIENT on its own: the web
  // build also shipped a Workbox precaching service worker (vite-plugin-pwa)
  // that answered navigations cache-first, BEFORE the network, so a fresh deploy
  // still needed a hard refresh even with the edge purged — the SW never asked
  // CloudFront. That SW has been removed (self-destroying; see
  // packages/web/vite.config.ts), so this edge invalidation is now the effective
  // freshness mechanism. Do NOT reintroduce a precaching SW without revisiting.
  invalidation: {
    paths: "all",
    wait: true,
  },
  // Attach the security-headers policy to the distribution's default behaviour,
  // and the `/g/*` redirect behaviours defined above.
  //
  // Use the callback form because SST shallow-merges object transforms at the
  // CdnArgs level. Supplying a partial `defaultCacheBehavior` object would
  // replace SST's generated behaviour and remove required fields such as
  // `allowedMethods`, the cache policy and CloudFront Function associations.
  transform: {
    cdn: (args) => {
      args.defaultCacheBehavior.responseHeadersPolicyId = securityHeaders.id;
      // Assigned, not appended: SST's StaticSite defines no ordered behaviours
      // of its own, so there is nothing here to preserve. Note that ordered
      // behaviours bypass SST's viewer-request function — including its
      // cloudfront.net 403 guard — but the redirect is site-RELATIVE, so a
      // `/g/*` request to the raw distribution URL 302s back to the same host
      // and the follow-up hits the default behaviour and is refused there.
      args.orderedCacheBehaviors = campaignRedirectBehaviors;
    },
  },
  environment: {
    VITE_REGION: region,
    VITE_CORE_API_URL: coreAPI.url,
    // Growth instrumentation (spec-30 WS3). PUBLIC, client-exposed by design —
    // the Meta Pixel id and Cloudflare Turnstile SITE key. Sourced from the
    // deploy job's env (GitHub env secrets); an empty/unset value makes the
    // pixel and the Turnstile widget no-op cleanly, so a stage without them
    // still builds and serves normally. NOT sensitive (unlike the server-side
    // Meta CAPI token / Turnstile SECRET, which live in SST Secrets).
    VITE_META_PIXEL_ID: process.env.VITE_META_PIXEL_ID ?? "",
    VITE_TURNSTILE_SITE_KEY: process.env.VITE_TURNSTILE_SITE_KEY ?? "",
    // The WAF-fronted marketing edge (spec-30 R3.3) the anonymous /leads +
    // /store-click POSTs go through. Empty on dev stages → the website's
    // `API_BASE` falls back to VITE_CORE_API_URL (today's direct call). Not
    // sensitive — it's a public CloudFront hostname.
    VITE_MARKETING_EDGE_URL: marketingEdgeOrigin,
    // Internal admin sign-in (FOUNDING-OFFER). PUBLIC values by design — the
    // project URL and the anon key are what every client already ships with.
    // The anon key comes from the deploy job's env like the pixel id; unset →
    // /admin/login renders "not configured" and nothing else changes.
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? "",
    // Store founders'-rate redemption URLs (MARKETING-PLANS WP3). PUBLIC — a
    // redemption URL is what an ad links to. Empty ⇒ no offer CTA renders on
    // that stage, which is the correct default: iOS must stay unset until one
    // code has been redeemed end to end on a fresh Apple ID and a
    // `user_subscriptions` row confirmed server-side (RevenueCat skips
    // anonymous ids). Configured in App Store Connect / Play Console; nothing
    // here reads or enforces the offer's price, cap or expiry.
    VITE_STORE_OFFER_IOS_URL: process.env.VITE_STORE_OFFER_IOS_URL ?? "",
    VITE_STORE_OFFER_ANDROID_URL:
      process.env.VITE_STORE_OFFER_ANDROID_URL ?? "",
  },
});

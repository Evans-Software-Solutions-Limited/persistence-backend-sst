import { coreAPI } from "./api";
import { webDomain, hostedZoneId } from "./domains";

const region = aws.getRegionOutput().name;

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
        contentSecurityPolicy: $interpolate`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' ${coreAPI.url} https://itunes.apple.com; form-action 'self'; upgrade-insecure-requests`,
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
  invalidation: {
    paths: "all",
    wait: true,
  },
  // Attach the security-headers policy to the distribution's default behaviour.
  // Merged into SST's generated defaultCacheBehavior, so the cache policy and
  // CloudFront Function associations SST sets up are preserved.
  transform: {
    cdn: {
      defaultCacheBehavior: {
        responseHeadersPolicyId: securityHeaders.id,
      },
    },
  },
  environment: {
    VITE_REGION: region,
    VITE_CORE_API_URL: coreAPI.url,
  },
});

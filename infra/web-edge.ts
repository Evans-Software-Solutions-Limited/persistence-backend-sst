import { getEnvironment } from "../packages/api-utils/src/domains";
import { coreAPI } from "./api";

/**
 * Public marketing edge — a CloudFront distribution fronting the Core API,
 * carrying a WAFv2 rate-based rule, that the WEBSITE routes its anonymous
 * marketing POSTs through (`/leads/waitlist`, `/leads/coach`, `/store-click`;
 * spec-30 R3.3). This is the durable, distributed-aware abuse control the
 * ad-driven traffic flows through — the per-container in-memory limiter in
 * `microservices/core/.../leads/rateLimit.ts` is only the origin-path backstop
 * for someone who discovers the raw API-Gateway URL and bypasses this edge.
 *
 * ─── Why a whole distribution, not "just attach a WAF" ───
 *
 * AWS WAF cannot attach to an HTTP API (`sst.aws.ApiGatewayV2`, API Gateway v2)
 * at all — WAFv2 web ACLs associate only with CloudFront, an Application Load
 * Balancer, an AppSync API, a Cognito user pool, or a REST (v1) API Gateway
 * stage. So the only way to put a WAF in front of these v2 routes is to front
 * them with CloudFront and attach the ACL to the distribution.
 *
 * ─── Why this does NOT touch the mobile build (the hard constraint) ───
 *
 * Mobile talks to the Core API DIRECTLY at `coreAPI.url` (its own
 * `EXPO_PUBLIC_API_URL`), and it never calls any of these three marketing
 * routes. This distribution is a SEPARATE hostname that only the website's two
 * marketing fetches point at (via `VITE_MARKETING_EDGE_URL`, wired in
 * infra/web.ts). Mobile — and every authenticated/data path of the website —
 * keeps hitting the API directly, unchanged. If `VITE_MARKETING_EDGE_URL` is
 * empty (dev stages, where this edge isn't created) the website falls back to
 * the direct API URL, i.e. exactly today's behaviour. Nothing that ships in a
 * binary changes.
 *
 * ─── Origin ───
 *
 * The origin is the raw execute-api endpoint (`coreAPI.nodes.api.apiEndpoint`),
 * NOT the custom `api.` domain: it always has a valid
 * `*.execute-api.<region>.amazonaws.com` TLS cert (no ACM dependency), it exists
 * on every stage, and an HTTP API's `$default` route has no stage path to strip.
 * Caching is DISABLED (managed `CachingDisabled` policy) — these are POSTs to a
 * dynamic API, nothing here is cacheable — and requests are forwarded verbatim
 * with the managed `AllViewerExceptHostHeader` origin-request policy, which
 * passes every viewer header (Origin, Content-Type, cookies, query) through
 * EXCEPT `Host`. Stripping Host is mandatory for an API Gateway origin: it
 * rejects a request whose Host isn't its own domain, and CloudFront then sets
 * Host to the origin. CORS is unaffected — the API already answers the
 * website's cross-origin calls today, and the same handler (reached via the
 * forwarded `Origin`) returns the same CORS headers regardless of which CDN
 * fronts it.
 *
 * ─── Scope guard ───
 *
 * Named stages only (production / staging), gated on the same tested
 * `getEnvironment` authority the rest of infra uses. Dev / personal stages skip
 * the edge entirely — a CloudFront distribution is ~10 min to deploy and would
 * be dead weight on a throwaway stage, and the website falls back to the direct
 * API there.
 *
 * ⚠ `infra/` has neither typecheck nor tests (see infra/monitoring.ts), so a
 * shape mistake here surfaces as a DEPLOY failure, not a red check. The resource
 * shapes below are the standard "CloudFront in front of API Gateway + WAFv2
 * rate rule" recipe; the two managed-policy IDs are AWS global constants.
 */

const isNamedStage = getEnvironment($app.stage) !== "dev";

// AWS-managed CloudFront policy IDs (global, stable constants).
//   CachingDisabled           — minTTL/defaultTTL/maxTTL all 0; never caches.
//   AllViewerExceptHostHeader — forward all viewer headers/cookies/query to the
//                               origin EXCEPT Host (required for API Gateway).
const CACHE_POLICY_CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const ORIGIN_REQUEST_ALL_VIEWER_EXCEPT_HOST =
  "b689b0a8-53d0-40ab-baf2-68738e2966ac";

// Per-IP request ceiling over WAF's 5-minute evaluation window, aggregated
// across ALL marketing routes on this distribution. Deliberately generous: a
// real visitor makes only a handful of requests in five minutes (a form submit,
// a CTA tap), so 500/5-min blocks a flood while never touching legitimate use.
// The tighter per-route, per-minute control is the origin backstop; this is the
// coarse volumetric net at the edge. Tune here if real traffic warrants it.
const WAF_RATE_LIMIT_PER_5MIN = 500;

/**
 * The marketing edge, or `undefined` on dev stages. `.url` is the
 * `https://<id>.cloudfront.net` origin the website's marketing POSTs target.
 */
export const marketingEdge = isNamedStage ? createMarketingEdge() : undefined;

function createMarketingEdge(): { url: $util.Output<string> } {
  // WAFv2 web ACLs for CloudFront MUST live in us-east-1, regardless of the
  // app's region (same constraint as a Route 53 health-check alarm; see the
  // note in infra/monitoring.ts). A dedicated, explicitly-regioned provider is
  // the standard way to pin just this resource there.
  const usEast1 = new aws.Provider("us-east-1-waf", { region: "us-east-1" });

  const webAcl = new aws.wafv2.WebAcl(
    "marketingEdgeWaf",
    {
      scope: "CLOUDFRONT",
      // Default allow — the single rule below blocks only IPs over the ceiling.
      defaultAction: { allow: {} },
      rules: [
        {
          name: "PerIpRateLimit",
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: WAF_RATE_LIMIT_PER_5MIN,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudwatchMetricsEnabled: true,
            metricName: "marketingEdgePerIpRateLimit",
          },
        },
      ],
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudwatchMetricsEnabled: true,
        metricName: "marketingEdgeWebAcl",
      },
    },
    { provider: usEast1 },
  );

  // Origin hostname = the execute-api endpoint's host, minus the scheme.
  const originDomain = coreAPI.nodes.api.apiEndpoint.apply(
    (endpoint) => new URL(endpoint).hostname,
  );

  const distribution = new aws.cloudfront.Distribution("marketingEdge", {
    enabled: true,
    isIpv6Enabled: true,
    httpVersion: "http2and3",
    comment: `persistence marketing edge (${$app.stage}) — WAF-fronted /leads + /store-click`,
    // NA + EU only — the marketing site's audience. Cheapest price class.
    priceClass: "PriceClass_100",
    origins: [
      {
        originId: "core-api",
        domainName: originDomain,
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          originProtocolPolicy: "https-only",
          originSslProtocols: ["TLSv1.2"],
        },
      },
    ],
    defaultCacheBehavior: {
      targetOriginId: "core-api",
      viewerProtocolPolicy: "redirect-to-https",
      // Full method set — these routes are POSTs, with OPTIONS for CORS preflight.
      allowedMethods: [
        "GET",
        "HEAD",
        "OPTIONS",
        "PUT",
        "POST",
        "PATCH",
        "DELETE",
      ],
      cachedMethods: ["GET", "HEAD"],
      cachePolicyId: CACHE_POLICY_CACHING_DISABLED,
      originRequestPolicyId: ORIGIN_REQUEST_ALL_VIEWER_EXCEPT_HOST,
      compress: true,
    },
    restrictions: { geoRestriction: { restrictionType: "none" } },
    // Default *.cloudfront.net cert — no custom domain, so no ACM needed. The
    // website reaches this by its CloudFront URL, not a branded host.
    viewerCertificate: { cloudfrontDefaultCertificate: true },
    webAclId: webAcl.arn,
  });

  return { url: $interpolate`https://${distribution.domainName}` };
}

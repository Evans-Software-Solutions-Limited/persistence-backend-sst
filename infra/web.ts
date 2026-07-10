import { coreAPI } from "./api";
import { webDomain, hostedZoneId } from "./domains";

const region = aws.getRegionOutput().name;

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
  environment: {
    VITE_REGION: region,
    VITE_CORE_API_URL: coreAPI.url,
  },
});

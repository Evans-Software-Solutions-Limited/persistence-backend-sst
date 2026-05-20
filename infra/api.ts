import { databaseUrl, stripeSecretKey, stripeWebhookSecret } from "./secrets";
import { coreApiDomain, hostedZoneId, supabaseUrl } from "./domains";
import { avatarsBucket } from "./storage";

// Custom domain only on stable named stages (production / staging). Personal
// dev stages fall back to the auto-generated API Gateway URL — the mobile
// client points at staging via EXPO_PUBLIC_API_URL during local development.
//
// `dns: sst.aws.dns({ zone: hostedZoneId })` is passed explicitly rather than
// relying on SST's auto-walk-up. Two reasons:
//   1. Staging deploys to a different AWS account than the parent zone
//      `evans-software-solutions.com` (which lives in the ESS production
//      account). Auto-detect via `route53:ListHostedZones` can't see across
//      account boundaries; explicit zone ID points SST at the staging
//      account's sub-delegated zone (`staging.persistence.evans-software-
//      solutions.com`) directly.
//   2. Even on production where the zone IS in the deploy account, explicit
//      zone passes through `route53:GetHostedZone(zoneId)` rather than
//      walking the hierarchy — narrower IAM surface, faster deploys.
//
// See docs/mobile-release-pipeline.md and packages/api-utils/src/domains/.
export const coreAPI = new sst.aws.ApiGatewayV2("api-core", {
  domain:
    coreApiDomain != null && hostedZoneId
      ? {
          name: coreApiDomain,
          dns: sst.aws.dns({ zone: hostedZoneId }),
        }
      : undefined,
});

export const otherServiceAPI = new sst.aws.ApiGatewayV2("api-other-service");

coreAPI.route("$default", {
  handler: "microservices/core/src/api.handler",
  link: [avatarsBucket],
  environment: {
    DATABASE_URL: databaseUrl.value,
    SUPABASE_URL: supabaseUrl,
    // Stripe — server-side only. The webhook handler uses
    // `STRIPE_WEBHOOK_SECRET` for signature verification, and outbound
    // subscription operations use `STRIPE_SECRET_KEY` against the Stripe
    // SDK. Both are set per-stage by deploy-staging.yml / production-
    // deploy.yml; missing values fail fast at handler init rather than
    // silently degrading to "no Stripe access".
    STRIPE_SECRET_KEY: stripeSecretKey.value,
    STRIPE_WEBHOOK_SECRET: stripeWebhookSecret.value,
  },
});

otherServiceAPI.route("$default", {
  handler: "microservices/other-service/src/api.handler",
  environment: {
    DATABASE_URL: databaseUrl.value,
    SUPABASE_URL: supabaseUrl,
  },
});

// api.addAuthorizer

import {
  databaseUrl,
  revenueCatApiKey,
  revenueCatProjectId,
  revenueCatWebhookSecret,
  stripeSecretKey,
  stripeWebhookSecret,
} from "./secrets";
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
    // RevenueCat (M12). `REVENUECAT_WEBHOOK_SECRET` authenticates inbound
    // POST /revenuecat/webhook; `REVENUECAT_API_KEY` + `REVENUECAT_PROJECT_ID`
    // are used to re-fetch the customer's active entitlements (the
    // authoritative read) after each webhook. Set per-stage by the deploy
    // workflows; missing values fail fast at handler use.
    REVENUECAT_WEBHOOK_SECRET: revenueCatWebhookSecret.value,
    REVENUECAT_API_KEY: revenueCatApiKey.value,
    REVENUECAT_PROJECT_ID: revenueCatProjectId.value,
  },
});

otherServiceAPI.route("$default", {
  handler: "microservices/other-service/src/api.handler",
  environment: {
    DATABASE_URL: databaseUrl.value,
    SUPABASE_URL: supabaseUrl,
  },
});

// ─── Scheduled Stripe⇄DB drift detection (spec 17 / Phase B, audit HIGH-3) ──
//
// Hourly read-only reconciliation. The handler logs `[reconcile:summary]`
// every run and `[reconcile:drift]` (ERROR) only when Stripe and the local
// mirror disagree. Wire a CloudWatch Logs metric filter on `[reconcile:drift]`
// + an alarm to page ops (see specs/17-payments-reliability/design.md runbook).
//
// Read-only: it never writes. Healing remains the manual, reviewed
// `scripts/reconcile-stripe.ts --write` op. Reuses the same DB + Stripe-key
// bindings as the API route; no webhook secret needed (outbound reads only).
export const reconcileCron = new sst.aws.Cron("reconcile-stripe-drift", {
  schedule: "rate(1 hour)",
  job: {
    handler: "microservices/core/src/reconcileCron.handler",
    timeout: "120 seconds",
    environment: {
      DATABASE_URL: databaseUrl.value,
      STRIPE_SECRET_KEY: stripeSecretKey.value,
    },
  },
});

// ─── Nightly streak sweep (06-progress-goals / M4, Phase 06.2) ──────────────
//
// 02:00 UTC daily. Detects active streaks whose last_period_end fell behind
// the most-recently-completed user-local period (the on-write engine advances
// it whenever a period is satisfied, so "behind" == "missed"). Spends a freeze
// token (quiet recovery) or breaks the streak. Logs `[streak-cron:summary]`
// each run. Reuses the same DATABASE_URL binding as the API route. See
// specs/06-progress-goals/design.md § Streak engine + cross-cuts § 3.4/§ 3.5.
export const streakCron = new sst.aws.Cron("streak-sweep", {
  schedule: "cron(0 2 * * ? *)",
  job: {
    handler: "microservices/core/src/streakCron.handler",
    timeout: "120 seconds",
    environment: {
      DATABASE_URL: databaseUrl.value,
    },
  },
});

// ─── Nightly volume aggregation sweep (06-progress-goals / M4, Phase 06.4) ──
//
// 03:00 UTC daily — one hour after the streak sweep. Re-materialises every
// active user's current-week total + current-month by-muscle volume into
// weekly_volume_per_user / volume_by_muscle_per_user so Home + You reads stay
// warm. On-session-complete recompute is the backup path (two-write
// redundancy). Logs `[volume-cron:summary]`. See design.md § Backend audit.
export const volumeCron = new sst.aws.Cron("volume-aggregation", {
  schedule: "cron(0 3 * * ? *)",
  job: {
    handler: "microservices/core/src/volumeCron.handler",
    timeout: "300 seconds",
    environment: {
      DATABASE_URL: databaseUrl.value,
    },
  },
});

// ─── Daily Open Food Facts delta refresh (M9 / 13-nutrition-tracking) ───────
//
// 04:00 UTC daily. Applies OFF's most-recent published daily delta (gzipped
// NDJSON) to the curated `foods` slice the one-shot seed loads, so cached
// barcode macros stay fresh without hitting the rate-limited live product API.
// Static published data (not the rate-limited API) but still sends the required
// custom User-Agent. Logs `[off-delta-cron:summary]`. See
// specs/13-nutrition-tracking/design.md § Data sources + DATA_SOURCING.md § 5.
export const offDeltaCron = new sst.aws.Cron("off-delta-refresh", {
  schedule: "cron(0 4 * * ? *)",
  job: {
    handler: "microservices/core/src/offDeltaCron.handler",
    timeout: "120 seconds",
    environment: {
      DATABASE_URL: databaseUrl.value,
      OFF_CONTACT_EMAIL: "apps@persistence.app",
    },
  },
});

// api.addAuthorizer

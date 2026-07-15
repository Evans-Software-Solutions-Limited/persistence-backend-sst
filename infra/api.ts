import {
  databaseUrl,
  expoAccessToken,
  revenueCatApiKey,
  revenueCatProjectId,
  revenueCatWebhookSecret,
  sentryDsn,
  stripeSecretKey,
  stripeWebhookSecret,
  supabaseServiceRoleKey,
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
  // Bedrock IAM auth for Tier B AI nutrition estimation (M9.5 —
  // specs/13-nutrition-tracking/design.md § Revised 2026-07-03). No
  // API-key secret: SigV4 auth from the Lambda execution role. Both
  // resource shapes are required —
  //   - `inference-profile/eu.anthropic.*` authorizes invoking the
  //     cross-region EU inference profile ids used by the adapter
  //     (`AI_PHOTO_MODEL_ID` / `AI_TEXT_MODEL_ID`);
  //   - `foundation-model/anthropic.*` authorizes the underlying
  //     regional foundation model that the inference profile routes to.
  // Bedrock denies the call if only the profile ARN is granted — the
  // profile is a routing indirection, not a standalone invokable unit.
  permissions: [
    {
      actions: ["bedrock:InvokeModel"],
      resources: [
        "arn:aws:bedrock:*::foundation-model/anthropic.*",
        "arn:aws:bedrock:*:*:inference-profile/eu.anthropic.*",
      ],
    },
  ],
  environment: {
    DATABASE_URL: databaseUrl.value,
    SUPABASE_URL: supabaseUrl,
    // Supabase service-role key — server-side only. Used exclusively by
    // `DELETE /account` to remove the `auth.users` record via the Admin REST
    // API (App Store Guideline 5.1.1(v) in-app account deletion). The endpoint
    // fails fast before purging any data when this is unset, so a stage
    // without the secret never half-deletes an account.
    SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey.value,
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
    // Expo Push (09.9 / A3). OPTIONAL bearer for the Expo Push API — the send
    // client omits the Authorization header when this is empty, so an unset /
    // empty value still deploys and sends (unauthenticated send works unless
    // "Enhanced Security for Push" is enabled on the Expo account). Set
    // per-stage by the deploy workflows; not fail-fast.
    EXPO_ACCESS_TOKEN: expoAccessToken.value,
    // Sentry DSN — backend crash/error reporting. OPTIONAL + fail-safe: empty
    // string is valid (`initSentry()` no-ops), so an unset value still deploys
    // and runs (mirrors EXPO_ACCESS_TOKEN, not the fail-fast secrets).
    SENTRY_DSN: sentryDsn.value,
    // AI Tier B model ids (M9.5). Plain deploy-time config, not secrets —
    // Bedrock auth is IAM (see `permissions` above), so there's nothing
    // sensitive here. Defaults match `nutrition/services/aiEstimation.ts`;
    // override per-stage if AWS ever grants direct (non-cross-region)
    // Opus 4.8 access and a cheaper/faster model id becomes preferable.
    AI_PHOTO_MODEL_ID: "eu.anthropic.claude-opus-4-6-v1",
    AI_TEXT_MODEL_ID: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    // Recipes AI (recipe-photo extraction). Same IAM permissions cover it —
    // the `inference-profile/eu.anthropic.*` + `foundation-model/anthropic.*`
    // wildcards above already authorize this model id, no IAM change needed.
    AI_RECIPE_MODEL_ID: "eu.anthropic.claude-opus-4-6-v1",
    // Coach AI Client Summary (Coach Mode Phase 6 — specs/10-trainer-features
    // design.md § Module g). Same Bedrock IAM auth as above; the summary is a
    // short synthesis over Client Detail modules a–f, so it defaults to the
    // cheap/fast EU Haiku id (override per-stage to a stronger model if the
    // coach summaries want more depth).
    AI_COACH_SUMMARY_MODEL_ID: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    // Daily per-user inference ceilings (cross-cuts § 4.3 Revised
    // 2026-07-05) — a cost backstop with a profit buffer, not a product
    // quota. Worst-case abuser ≈ £7.30/mo vs the £12.99 premium sub.
    AI_PHOTO_DAILY_LIMIT: "12",
    AI_TEXT_DAILY_LIMIT: "30",
    // Recipes AI daily ceilings (same cost-backstop rationale as above).
    AI_RECIPE_DAILY_LIMIT: "12",
    AI_RESOLVE_DAILY_LIMIT: "60",
    // Per-COACH daily ceiling for AI Client Summaries (design.md § Module g
    // "Per-coach daily backstop"). Net worst case min(2 × opened-clients,
    // this). Sized for a full coaching roster; a cost backstop, not a quota.
    AI_COACH_SUMMARY_DAILY_LIMIT: "40",
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
      // Sentry crash reporting (optional; empty DSN = disabled).
      SENTRY_DSN: sentryDsn.value,
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
      // Streak notifier emits push via the dispatcher; mirror the API route's
      // binding so Enhanced-Security-on sends don't silently 4xx in this Lambda.
      EXPO_ACCESS_TOKEN: expoAccessToken.value,
      // Sentry crash reporting (optional; empty DSN = disabled).
      SENTRY_DSN: sentryDsn.value,
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
      // Sentry crash reporting (optional; empty DSN = disabled).
      SENTRY_DSN: sentryDsn.value,
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
      // Sentry crash reporting (optional; empty DSN = disabled).
      SENTRY_DSN: sentryDsn.value,
    },
  },
});

// ─── Nightly account-purge sweep (Cluster 2a — 30-day soft-delete) ─────────
//
// 05:00 UTC daily — after the other nightly sweeps. Completes every account
// whose cooling-off window (`profiles.deleted_at`/`purge_after`, stamped by
// `DELETE /account`) has elapsed: safety-net Stripe cancel → the corrected
// `ACCOUNT_DELETION_STEPS` SQL purge (Part A) → Supabase auth-user delete →
// best-effort avatar S3 cleanup (Part B). Logs `[account-purge-cron:summary]`
// each run; per-user failures are isolated (see accountPurgeCron.ts) so one
// bad user never blocks the rest of the batch. `link: [avatarsBucket]` grants
// the same `s3:*Object` access `profilesAvatarHandler` gets on the API route,
// for the DeleteObjectCommand in `deleteUserAvatar.ts`.
export const accountPurgeCron = new sst.aws.Cron("account-purge-sweep", {
  schedule: "cron(0 5 * * ? *)",
  job: {
    handler: "microservices/core/src/accountPurgeCron.handler",
    timeout: "300 seconds",
    link: [avatarsBucket],
    environment: {
      DATABASE_URL: databaseUrl.value,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey.value,
      STRIPE_SECRET_KEY: stripeSecretKey.value,
      // Sentry crash reporting (optional; empty DSN = disabled).
      SENTRY_DSN: sentryDsn.value,
    },
  },
});

// api.addAuthorizer

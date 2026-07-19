/**
 * Custom-domain config per stage. Wraps the pure logic in
 * `@persistence/api-utils/domains` with the SST `$app.stage` lookup so
 * `infra/` modules can `import { coreApiDomain, hostedZoneId } from
 * "./domains"` and pass them straight to SST.
 *
 * - production: api.persistence.evans-software-solutions.com
 *   (Route 53 zone Z00258092KJ0WAEWI2IF8 — evans-software-solutions.com,
 *   ESS production AWS account)
 * - staging:    api.staging.persistence.evans-software-solutions.com
 *   (Route 53 zone Z051866999VDKAQLS5RX — staging.persistence.evans-
 *   software-solutions.com, staging AWS account; sub-delegated from the
 *   production zone via NS records)
 * - dev / personal stages: null — no custom domain; falls back to the
 *   auto-generated API Gateway URL. Mobile dev points at staging via
 *   `EXPO_PUBLIC_API_URL` (see `docs/mobile-release-pipeline.md`).
 *
 * Each environment's deploy account writes only into its own delegated
 * zone — no cross-account Route 53 access required, no IAM gymnastics.
 * Same pattern as the funds-distribution-platform repo.
 */
import {
  getDomainConfig,
  type DomainConfig,
} from "../../packages/api-utils/src/domains";

export type { DomainConfig };

const domainConfig = getDomainConfig($app.stage);

/** Core API custom domain for SST. `null` for dev — no custom domain. */
export const coreApiDomain = domainConfig.apiHost;

/**
 * Web static-site custom domain for SST (the public marketing/legal site —
 * hosts the ASC-facing `/privacy` + `/terms`). `null` for dev, where the
 * StaticSite falls back to its auto-generated CloudFront URL.
 * - production: persistence.evans-software-solutions.com
 * - staging:    staging.persistence.evans-software-solutions.com
 */
export const webDomain = domainConfig.webHost;

/**
 * Route 53 hosted zone ID for the env's parent zone. `undefined` for
 * dev. Passed to SST as `sst.aws.dns({ zone: hostedZoneId })` so the
 * deploy doesn't have to walk parent zones via `route53:ListHostedZones`
 * (which fails when the parent zone is in a different AWS account, as
 * is the case for staging).
 */
export const hostedZoneId = domainConfig.zoneId;

/**
 * Supabase project URL for the env. Baked into the Lambda environment
 * at SST build time, used by `@persistence/api-utils/auth/supabaseAuth`
 * to fetch JWKS for JWT verification.
 *
 * The previous wiring read `process.env.SUPABASE_URL` from the GH
 * Actions runner env at deploy time — but the runner never had that
 * env var set, so the Lambda shipped with `SUPABASE_URL=""` and every
 * authenticated request 500'd at the JWKS lookup. This static config
 * removes the deploy-time env-var dependency entirely.
 */
export const supabaseUrl = domainConfig.supabaseUrl;

/**
 * SES sender domain for the env. `null` for dev — `infra/email.ts` only
 * provisions an SES identity + SMTP creds on named stages (production /
 * staging), gated on this being non-null alongside `hostedZoneId`.
 * - production → evans-software-solutions.com (apex; Google MX untouched)
 * - staging    → staging.persistence.evans-software-solutions.com
 */
export const emailDomain = domainConfig.emailDomain;

/**
 * The `From` address (`no-reply@<emailDomain>`) auth email is sent as.
 * `null` for dev. Written to SSM by `infra/email.ts` for the Supabase
 * custom-SMTP "sender" field.
 */
export const emailSender = domainConfig.emailSender;

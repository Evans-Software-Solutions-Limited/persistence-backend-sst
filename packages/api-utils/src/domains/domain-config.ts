/**
 * Pure domain config logic (no SST globals). Used by `infra/` at deploy time
 * and unit-tested without `$app.stage`.
 *
 * Stages:
 * - `production` → api.persistence.evans-software-solutions.com
 *   (parent zone: evans-software-solutions.com, in the production AWS account)
 * - `staging`    → api.staging.persistence.evans-software-solutions.com
 *   (parent zone: staging.persistence.evans-software-solutions.com, in the
 *   staging AWS account; sub-delegated from the production zone via NS
 *   records on `staging.persistence` in the parent)
 * - everything else (dev / personal stages) → no custom domain; the mobile
 *   client points at staging via `EXPO_PUBLIC_API_URL`, the web client uses
 *   the auto-generated API Gateway URL or a localhost proxy.
 *
 * Per-env hosted-zone IDs are hardcoded (zone IDs are not sensitive — they
 * appear in NS records and WHOIS) and passed to SST explicitly via
 * `dns: sst.aws.dns({ zone })` so the deploy doesn't have to walk parent
 * zones via `route53:ListHostedZones`. This is the same pattern the
 * funds-distribution-platform repo uses for its qa / preprod / prod
 * accounts; each account writes only into its own delegated zone.
 */

export const BASE_DOMAIN = "persistence.evans-software-solutions.com";

/**
 * Route 53 hosted zone IDs per environment.
 *
 * - `production`: the parent `evans-software-solutions.com` zone in the
 *   ESS production AWS account. Records under `*.persistence.*` are
 *   created directly in this zone.
 * - `staging`: a sub-delegated zone for `staging.persistence.evans-software-
 *   solutions.com` in the staging AWS account. The production parent zone
 *   has NS records on `staging.persistence` pointing at this zone's name
 *   servers, so the staging account fully owns its subtree without ever
 *   touching the production zone.
 *
 * Dev / personal stages: undefined — no custom domain, no zone needed.
 */
const ZONE_IDS: Record<"production" | "staging", string> = {
  production: "Z00258092KJ0WAEWI2IF8",
  staging: "Z051866999VDKAQLS5RX",
};

/**
 * Supabase project URLs per environment.
 *
 * Public values — the URL is half of every Supabase request and the anon
 * key (its sibling in the mobile bundle) is public-by-design. Keeping
 * them in source means:
 *
 *   1. The Lambda gets the value baked in at SST build time without any
 *      `process.env.SUPABASE_URL` indirection on the runner. The
 *      previous wiring (`process.env.SUPABASE_URL ?? ""`) silently
 *      shipped an empty string when the runner had no such env var,
 *      which broke every JWT-validating handler at runtime.
 *   2. Single source of truth across Lambda runtime + the mobile client
 *      (mobile reads its mirror from `eas.json`'s `env` block — the
 *      anon key alongside the URL — so no code reads a missing env var
 *      either side).
 *   3. When the project moves off the free tier, this map gets a
 *      different value per environment in one PR — no per-stage SST
 *      Secret rotation, no GH-secret drift.
 *
 * Currently identical across stages because the project shares one
 * Supabase free-tier DB. Diverges when production gets its own project.
 */
const SUPABASE_URLS: Record<"production" | "staging", string> = {
  production: "https://dfeyebgdktfteqlacmru.supabase.co",
  staging: "https://dfeyebgdktfteqlacmru.supabase.co",
};

export type Environment = "production" | "staging" | "dev";

export interface DomainConfig {
  /** API custom domain for SST. `null` for dev — no custom domain. */
  apiHost: string | null;
  /**
   * Web (static site) custom domain for SST. The public marketing/legal site
   * — hosts `/privacy` + `/terms` (the App Store Connect metadata URLs) today,
   * and grows into the full site later. Sits alongside the `api.` host:
   *   - production → persistence.evans-software-solutions.com
   *     (a subdomain record in the parent evans-software-solutions.com zone)
   *   - staging    → staging.persistence.evans-software-solutions.com
   *     (the apex of the delegated staging zone)
   * `null` for dev — the web client uses the auto-generated CloudFront URL.
   */
  webHost: string | null;
  /**
   * Route 53 hosted zone ID for the env's parent zone. `undefined` for
   * dev (no DNS-managed deploy). Passed to SST as `sst.aws.dns({ zone })`.
   */
  zoneId: string | undefined;
  /**
   * Supabase project URL the Lambda uses for JWT verification (fetches
   * `/auth/v1/.well-known/jwks.json` against this host). Empty string
   * for dev so local-dev `bun run dev` falls back to whatever's in the
   * runner's process.env — same as before this field existed.
   */
  supabaseUrl: string;
}

/**
 * Maps a raw SST stage to the logical environment. Stable named stages
 * (`production`, `staging`) map directly; everything else is `dev` and
 * gets no custom domain.
 */
export function getEnvironment(stage: string): Environment {
  if (stage === "production") return "production";
  if (stage === "staging") return "staging";
  return "dev";
}

/**
 * Derives the API host + zone ID from the stage. Returns `null` /
 * `undefined` for dev so callers (and SST) can gracefully fall back to
 * the auto-generated API Gateway URL.
 */
export function getDomainConfig(stage: string): DomainConfig {
  const environment = getEnvironment(stage);
  switch (environment) {
    case "production":
      return {
        apiHost: `api.${BASE_DOMAIN}`,
        webHost: BASE_DOMAIN,
        zoneId: ZONE_IDS.production,
        supabaseUrl: SUPABASE_URLS.production,
      };
    case "staging":
      return {
        apiHost: `api.staging.${BASE_DOMAIN}`,
        webHost: `staging.${BASE_DOMAIN}`,
        zoneId: ZONE_IDS.staging,
        supabaseUrl: SUPABASE_URLS.staging,
      };
    case "dev":
      // Local dev / personal stages fall back to process.env so
      // `bun run dev` against a developer's own .env keeps working.
      return {
        apiHost: null,
        webHost: null,
        zoneId: undefined,
        supabaseUrl: process.env.SUPABASE_URL ?? "",
      };
  }
}

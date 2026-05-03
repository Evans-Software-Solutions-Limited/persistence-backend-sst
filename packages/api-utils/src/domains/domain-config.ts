/**
 * Pure domain config logic (no SST globals). Used by `infra/` at deploy time
 * and unit-tested without `$app.stage`.
 *
 * Stages:
 * - `production` → api.persistence.evans-software-solutions.com
 * - `staging`    → api.staging.persistence.evans-software-solutions.com
 * - everything else (dev / personal stages) → no custom domain; the mobile
 *   client points at staging via `EXPO_PUBLIC_API_URL`, the web client uses
 *   the auto-generated API Gateway URL or a localhost proxy.
 *
 * Mirrors the funds-distribution-platform pattern so the two projects stay
 * legible from each other.
 */

export const BASE_DOMAIN = "persistence.evans-software-solutions.com";

export type Environment = "production" | "staging" | "dev";

export interface DomainConfig {
  /** API custom domain for SST. `null` for dev — no custom domain. */
  apiHost: string | null;
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
 * Derives the API host from the stage. Returns `null` for dev so callers
 * (and SST) can gracefully fall back to the auto-generated API Gateway URL.
 */
export function getDomainConfig(stage: string): DomainConfig {
  const environment = getEnvironment(stage);
  switch (environment) {
    case "production":
      return { apiHost: `api.${BASE_DOMAIN}` };
    case "staging":
      return { apiHost: `api.staging.${BASE_DOMAIN}` };
    case "dev":
      return { apiHost: null };
  }
}

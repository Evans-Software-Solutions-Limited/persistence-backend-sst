/**
 * Custom-domain config per stage. Wraps the pure logic in
 * `@persistence/api-utils/domains` with the SST `$app.stage` lookup so
 * `infra/` modules can `import { coreApiDomain } from "./domains"` and
 * pass it straight to SST.
 *
 * - production: api.persistence.evans-software-solutions.com
 * - staging:    api.staging.persistence.evans-software-solutions.com
 * - dev / personal stages: null — no custom domain; falls back to the
 *   auto-generated API Gateway URL. Mobile dev points at staging via
 *   `EXPO_PUBLIC_API_URL` (see `docs/mobile-release-pipeline.md`).
 *
 * DNS lives in the single Route 53 hosted zone for
 * `evans-software-solutions.com`. SST auto-detects the zone by name; no
 * explicit `dns:` config needed unless we move DNS off Route 53.
 */
import {
  getDomainConfig,
  type DomainConfig,
} from "../../packages/api-utils/src/domains";

export type { DomainConfig };

const domainConfig = getDomainConfig($app.stage);

/** Core API custom domain for SST. `null` for dev — no custom domain. */
export const coreApiDomain = domainConfig.apiHost;

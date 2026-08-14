/**
 * Base URL for the PUBLIC marketing POST routes (`/leads/*`, `/store-click`).
 *
 * Prefers the WAF-fronted marketing edge (`VITE_MARKETING_EDGE_URL`, spec-30
 * R3.3) so anonymous, ad-driven traffic flows through the CloudFront + WAFv2
 * rate-based rule. Falls back to the direct Core API (`VITE_CORE_API_URL`) when
 * the edge var is empty — dev stages, where no edge is provisioned — so these
 * calls behave exactly as they did before the edge existed.
 *
 * Trailing slashes are stripped so callers can append `/leads/waitlist` etc.
 * without doubling the separator. Only these anonymous marketing POSTs use this;
 * the website's authenticated/data calls keep hitting `VITE_CORE_API_URL`
 * directly (the edge fronts only the marketing routes).
 */
export function marketingApiBase(): string {
  const edge = import.meta.env.VITE_MARKETING_EDGE_URL;
  const base =
    edge && edge.length > 0 ? edge : (import.meta.env.VITE_CORE_API_URL ?? "");
  return base.replace(/\/+$/, "");
}

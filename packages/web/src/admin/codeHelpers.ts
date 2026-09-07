import type { ReferralCodeRow } from "./adminApi";

export function suggestCode(label: string): string {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 24);
}

export function shareLink(
  code: ReferralCodeRow,
  origin = window.location.origin,
): string {
  return `${origin}/qr/${code.campaignSlug ?? "default"}?ref=${encodeURIComponent(code.code)}`;
}

/**
 * `Founders' offer — Sep 2026` → `founders-offer-sep-2026`. Suggests a plan
 * slug from its name; the API normalises anyway, but the form shows what will
 * be stored.
 *
 * Lives here rather than beside the page: exporting a non-component from a
 * component module breaks react-refresh.
 */
export function suggestPlanSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

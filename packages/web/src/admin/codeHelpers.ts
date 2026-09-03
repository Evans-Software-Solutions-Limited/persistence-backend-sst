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

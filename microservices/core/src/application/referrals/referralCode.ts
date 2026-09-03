/**
 * Referral-code normalisation shared by the admin create path and the user
 * claim path, so "uon freshers", "UON-FRESHERS" and "UonFreshers" all resolve
 * to the same canonical `UONFRESHERS` (FOUNDING-OFFER BACKEND_BRIEF § 4).
 */
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{4,24}$/;

export function normalizeReferralCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
}

export function isValidReferralCode(canonical: string): boolean {
  return REFERRAL_CODE_PATTERN.test(canonical);
}

/**
 * Derive a code suggestion from a human label ("Uni of Nottingham freshers"
 * → "UNIOFNOTTINGHAMFRESHERS" trimmed to 24). Used by the admin UI only.
 */
export function suggestReferralCode(label: string): string {
  const canonical = normalizeReferralCode(label).replace(/[^A-Z0-9]/g, "");
  return canonical.slice(0, 24);
}

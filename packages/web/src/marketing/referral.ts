export const REFERRAL_STORAGE_KEY = "persistence.ref";

const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{4,24}$/;

export function normalizeReferralCode(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.toUpperCase().replace(/[\s-]+/g, "");
  return REFERRAL_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function storedReferralCode(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return normalizeReferralCode(
      window.sessionStorage.getItem(REFERRAL_STORAGE_KEY),
    ) ?? undefined;
  } catch {
    return undefined;
  }
}

export function storeReferralCode(code: string): void {
  try {
    window.sessionStorage.setItem(REFERRAL_STORAGE_KEY, code);
  } catch {
    // Referral capture must not make a marketing page unusable when storage is
    // unavailable (for example, in a locked-down browser context).
  }
}

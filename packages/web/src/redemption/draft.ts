export interface RedemptionDraft {
  code: string;
  eligibilityEmail: string;
  accountEmail: string;
  differentAccount: boolean;
}
const KEY = "persistence.redemption.draft";
export const EMPTY_DRAFT: RedemptionDraft = {
  code: "",
  eligibilityEmail: "",
  accountEmail: "",
  differentAccount: false,
};
export function loadDraft(): RedemptionDraft {
  try {
    const d = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (
      !d ||
      typeof d.code !== "string" ||
      typeof d.eligibilityEmail !== "string" ||
      typeof d.accountEmail !== "string" ||
      typeof d.differentAccount !== "boolean" ||
      !Number.isFinite(d.savedAt) ||
      Date.now() - d.savedAt > 3600000
    )
      return EMPTY_DRAFT;
    return {
      code: d.code,
      eligibilityEmail: d.eligibilityEmail,
      accountEmail: d.accountEmail,
      differentAccount: d.differentAccount,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}
export function saveDraft(draft: RedemptionDraft) {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({ ...draft, savedAt: Date.now() }),
  );
}
export function clearDraft() {
  sessionStorage.removeItem(KEY);
}

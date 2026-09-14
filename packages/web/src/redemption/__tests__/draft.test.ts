import { afterEach, expect, it, vi } from "vitest";
import { loadDraft, saveDraft, clearDraft, EMPTY_DRAFT } from "../draft";
afterEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});
it("retains only voucher details, expires drafts and tolerates invalid storage", () => {
  expect(loadDraft()).toEqual(EMPTY_DRAFT);
  const draft = {
    code: "code",
    eligibilityEmail: "work@example.com",
    accountEmail: "me@example.com",
    differentAccount: true,
  };
  saveDraft(draft);
  expect(loadDraft()).toEqual(draft);
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 3600001);
  expect(loadDraft()).toEqual(EMPTY_DRAFT);
  clearDraft();
  expect(sessionStorage.length).toBe(0);
  sessionStorage.setItem("persistence.redemption.draft", "bad");
  expect(loadDraft()).toEqual(EMPTY_DRAFT);
  sessionStorage.setItem(
    "persistence.redemption.draft",
    JSON.stringify({ code: 5 }),
  );
  expect(loadDraft()).toEqual(EMPTY_DRAFT);
});

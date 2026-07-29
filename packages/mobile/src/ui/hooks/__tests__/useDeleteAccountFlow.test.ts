import { formatPurgeAfter } from "@/ui/hooks/useDeleteAccountFlow";

/**
 * The double-confirm flow itself is driven end-to-end through both of its entry
 * points — `PrivacySettingsContainer.test.tsx` (Privacy screen) and
 * `ProfileDrawerPresenter.test.tsx` (drawer row). What those can't reach is the
 * unparseable-timestamp fallback, which only fires if the backend hands back a
 * `purgeAfter` we can't read. It matters because the string lands in the
 * post-deletion confirmation alert: without the guard the user would be told
 * their account is deleted on "Invalid Date".
 */
describe("formatPurgeAfter", () => {
  it("renders a UTC calendar date, immune to the device timezone", () => {
    // UTC midnight — reading this with local getters in a negative-offset zone
    // would render 11 August instead of 12.
    expect(formatPurgeAfter("2026-08-12T00:00:00.000Z")).toBe("12 August 2026");
  });

  it("falls back to a relative phrase when the timestamp is unparseable", () => {
    expect(formatPurgeAfter("not-a-date")).toBe("in 30 days");
    expect(formatPurgeAfter("")).toBe("in 30 days");
  });
});

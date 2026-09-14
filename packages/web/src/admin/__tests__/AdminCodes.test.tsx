import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { AdminDialogProvider } from "../AdminDialogs";
import { AdminCodes } from "../pages/AdminCodes";
import { adminApi, type ReferralCodeRow } from "../adminApi";
const code: ReferralCodeRow = {
  id: "c1",
  code: "TEAM",
  displayCode: "TEAM",
  label: "Team",
  partnerName: null,
  kind: "vendor",
  status: "active",
  maxRedemptions: null,
  redemptionCount: 1,
  grantCount: 0,
  paidCount: 0,
  startsAt: null,
  endsAt: null,
  notes: null,
  campaignSlug: null,
  createdAt: "2026-09-01T00:00:00Z",
};
function page() {
  return renderPage(
    <AdminDialogProvider>
      <AdminCodes />
    </AdminDialogProvider>,
  );
}
function change(label: string, value: string) {
  fireEvent.change(
    screen.getByLabelText(
      label === "Max uses"
        ? "Max uses (blank = unlimited)"
        : label === "Campaign slug"
          ? "Campaign slug (optional)"
          : label,
      { exact: true },
    ),
    {
      target: { value },
    },
  );
}
describe("referral admin actions", () => {
  beforeEach(() => {
    vi.spyOn(adminApi, "codes").mockResolvedValue([code]);
    vi.spyOn(adminApi, "createCode").mockResolvedValue(code);
    vi.spyOn(adminApi, "updateCode").mockResolvedValue(code);
    vi.spyOn(adminApi, "redemptions").mockResolvedValue([]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("creates normalised codes with and without optional attribution", async () => {
    page();
    change("Label", "Fair day");
    expect(screen.getByLabelText("Code", { exact: true })).toHaveProperty(
      "value",
      "FAIRDAY",
    );
    change("Code", "my-code");
    change("Label", "New label");
    change("Partner / vendor", "Acme");
    change("Kind", "campaign");
    change("Max uses", "2");
    change("Campaign slug", "meta");
    fireEvent.submit(screen.getByRole("form", { name: "New referral code" }));
    await waitFor(() =>
      expect(vi.mocked(adminApi.createCode).mock.calls[0]?.[0]).toEqual({
        code: "MYCODE",
        label: "New label",
        partnerName: "Acme",
        kind: "campaign",
        maxRedemptions: 2,
        campaignSlug: "meta",
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Label")).toHaveProperty("value", ""),
    );
    change("Label", "Simple");
    change("Code", "");
    fireEvent.submit(screen.getByRole("form", { name: "New referral code" }));
    await waitFor(() =>
      expect(vi.mocked(adminApi.createCode).mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({
          code: "SIMPLE",
          partnerName: null,
          maxRedemptions: null,
          campaignSlug: null,
        }),
      ),
    );
  });
  it("filters and pauses/resumes codes", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(adminApi.updateCode).toHaveBeenCalledWith("c1", {
        status: "paused",
      }),
    );
    change("Search codes", "abc");
    change("Filter by status", "paused");
    vi.mocked(adminApi.codes).mockResolvedValue([
      { ...code, status: "paused", partnerName: "Acme", maxRedemptions: 5 },
    ]);
    change("Search codes", "def");
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(adminApi.updateCode).toHaveBeenCalledWith("c1", {
        status: "active",
      }),
    );
  });
  it("archives only after the branded confirmation", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(adminApi.updateCode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(adminApi.updateCode).toHaveBeenCalledWith("c1", {
        status: "archived",
      }),
    );
  });
  it("shows code uses and no actions for archived codes", async () => {
    vi.mocked(adminApi.codes).mockResolvedValue([
      { ...code, status: "archived" },
    ]);
    vi.mocked(adminApi.redemptions).mockResolvedValue([
      {
        userId: "u1",
        email: "a@example.com",
        source: "app",
        createdAt: "2026-09-01",
        lockedAt: "2026-09-02",
      },
      {
        userId: "u2",
        email: null,
        source: "web",
        createdAt: "2026-09-01",
        lockedAt: null,
      },
    ]);
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Uses" }));
    expect(await screen.findByText("a@example.com")).toBeTruthy();
    expect(screen.getByText("u2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide uses" }));
    expect(screen.queryByText("a@example.com")).toBeNull();
  });
  it("shows redemption errors and empty states", async () => {
    const view = page();
    fireEvent.click(await screen.findByRole("button", { name: "Uses" }));
    expect(
      await screen.findByText("No one has used this code yet."),
    ).toBeTruthy();
    view.unmount();
    vi.mocked(adminApi.redemptions).mockRejectedValue(
      new Error("Uses unavailable"),
    );
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Uses" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Uses unavailable",
    );
  });
  it("provides a selectable link if clipboard is unavailable", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    const input = await screen.findByRole("textbox", {
      name: "Copy this link",
    });
    expect((input as HTMLInputElement).value).toContain("TEAM");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
  it("copies referral links with clipboard support", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(writeText).toHaveBeenCalled();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  it("surfaces creation and listing errors", async () => {
    vi.mocked(adminApi.codes).mockResolvedValue([]);
    vi.mocked(adminApi.createCode).mockRejectedValue(
      new Error("Duplicate code"),
    );
    const view = page();
    change("Label", "Some");
    fireEvent.submit(screen.getByRole("form", { name: "New referral code" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Duplicate code",
    );
    view.unmount();
    vi.mocked(adminApi.codes).mockRejectedValue(new Error("Codes unavailable"));
    page();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Codes unavailable",
    );
  });
});

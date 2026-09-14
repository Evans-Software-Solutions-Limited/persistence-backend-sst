import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { AdminDialogProvider } from "../AdminDialogs";
import { AdminLookup } from "../pages/AdminLookup";
import { adminApi, type UserLookup } from "../adminApi";
const account: NonNullable<UserLookup["account"]> = {
  id: "u1",
  email: "a@example.com",
  role: null,
  subscription: null,
  attribution: null,
  foundingGrants: [],
};
function page() {
  renderPage(
    <AdminDialogProvider>
      <AdminLookup />
    </AdminDialogProvider>,
  );
  fireEvent.change(screen.getByLabelText("Email to look up"), {
    target: { value: "a@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Look up" }));
}
async function answer(text: string) {
  fireEvent.change(
    await screen.findByRole("textbox", { name: /Referral code|Reason/ }),
    { target: { value: text } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}
describe("admin account attribution dialogs", () => {
  beforeEach(() => {
    vi.spyOn(adminApi, "lookupUser").mockResolvedValue({
      account,
      pendingGrants: [],
    });
    vi.spyOn(adminApi, "setAttribution").mockResolvedValue({ data: {} });
  });
  afterEach(() => vi.restoreAllMocks());
  it("sets attribution through two explicit dialogs", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Set" }));
    await answer(" TEAM ");
    await answer(" Partner event ");
    await waitFor(() =>
      expect(adminApi.setAttribution).toHaveBeenCalledWith(
        "u1",
        "TEAM",
        "Partner event",
      ),
    );
  });
  it.each(["code", "reason", "short"])(
    "cancels without mutation at %s",
    async (stage) => {
      page();
      fireEvent.click(await screen.findByRole("button", { name: "Set" }));
      if (stage !== "code") await answer("TEAM");
      if (stage === "short") await answer("x");
      else
        fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
      expect(adminApi.setAttribution).not.toHaveBeenCalled();
    },
  );
  it("shows change action and subscription date for unlocked attribution", async () => {
    vi.mocked(adminApi.lookupUser).mockResolvedValue({
      account: {
        ...account,
        role: "coach",
        subscription: {
          tierName: "premium",
          paymentStatus: "active",
          expiresAt: "2027-01-01",
          cancelledAt: null,
          externalSubscriptionId: null,
          fromStore: false,
        },
        attribution: { code: "TEAM", label: "Team", lockedAt: null },
      },
      pendingGrants: [],
    });
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    await answer("NEW");
    await answer("Updated team");
    await waitFor(() => expect(adminApi.setAttribution).toHaveBeenCalled());
  });
  it("prevents changing locked attribution and handles an undated subscription", async () => {
    vi.mocked(adminApi.lookupUser).mockResolvedValue({
      account: {
        ...account,
        subscription: {
          tierName: "premium",
          paymentStatus: "active",
          expiresAt: null,
          cancelledAt: null,
          externalSubscriptionId: null,
          fromStore: false,
        },
        attribution: { code: "TEAM", label: "Team", lockedAt: "2026-09-01" },
      },
      pendingGrants: [],
    });
    page();
    expect(await screen.findByText(/Team \(TEAM\) · locked/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });
  it("surfaces attribution errors", async () => {
    vi.mocked(adminApi.setAttribution).mockRejectedValue(
      new Error("Attribution unavailable"),
    );
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Set" }));
    await answer("TEAM");
    await answer("Reason supplied");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Attribution unavailable",
    );
  });
  it("renders lookup error and missing account with pending grant", async () => {
    vi.mocked(adminApi.lookupUser).mockRejectedValue(
      new Error("Lookup unavailable"),
    );
    page();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Lookup unavailable",
    );
  });
  it.each([
    { pendingGrants: [] },
    {
      pendingGrants: [
        { id: "pending", tierName: "premium", months: 12, invitedAt: null },
      ],
    },
  ])(
    "explains missing accounts and pending grants",
    async ({ pendingGrants }) => {
      vi.mocked(adminApi.lookupUser).mockResolvedValue({
        account: null,
        pendingGrants,
      });
      page();
      expect(await screen.findByText(/No account for/)).toBeTruthy();
      expect(
        screen.getByRole("link", { name: "Record an access grant for them" }),
      ).toBeTruthy();
    },
  );
});

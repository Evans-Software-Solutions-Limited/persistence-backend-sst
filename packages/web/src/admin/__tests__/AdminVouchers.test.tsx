import { GRANTABLE_TIERS } from "@persistence/subscription-catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { Route, Routes, useNavigate } from "react-router";
import { AdminVouchers, NewVoucherBatch } from "../pages/AdminVouchers";
import { voucherApi } from "../voucherApi";
import * as csv from "../voucherCsv";
import { batch } from "./voucherFixtures";
import { saveSession } from "../adminAuth";
import { loadIssuedVouchers } from "../issuedVouchers";
const issued = {
  batch,
  codes: [{ id: "v1", code: "SECRET-ONCE", employeeEmail: null }],
};
function change(label: string, value: string) {
  fireEvent.change(
    screen.getByLabelText(label, { exact: label === "Membership" }),
    {
      target: { value },
    },
  );
}
function submit() {
  fireEvent.submit(
    screen.getByRole("button", { name: "Generate codes" }).closest("form")!,
  );
}
describe("business voucher administration", () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveSession({
      accessToken: "test",
      refreshToken: null,
      expiresAt: 9999999999,
      email: "admin@example.com",
      isAdmin: true,
    });
    vi.spyOn(voucherApi, "batches").mockResolvedValue([batch]);
    vi.spyOn(voucherApi, "create").mockResolvedValue(issued);
    vi.spyOn(voucherApi, "exportAudit").mockResolvedValue({ recorded: true });
    vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });
  it("lists batch counts and filters/searches", async () => {
    renderPage(<AdminVouchers />);
    expect(await screen.findByText("Acme")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "View Acme" }).getAttribute("href"),
    ).toBe("/admin/vouchers/b1");
    change("Batch code status", "expired");
    expect(screen.getByText(/No matching batches/)).toBeTruthy();
    change("Search voucher batches", "order");
    await waitFor(() =>
      expect(voucherApi.batches).toHaveBeenCalledWith("order"),
    );
  });
  it("creates an unrestricted batch and keeps codes available until save acknowledgement", async () => {
    renderPage(<AdminVouchers />);
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    change("Business name", "Acme");
    submit();
    expect(await screen.findByText(/Your new codes are ready/)).toBeTruthy();
    expect(voucherApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedDomains: [],
        quantity: 10,
        months: 12,
        employeeEmails: undefined,
        redeemBy: null,
      }),
    );
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Download codes CSV" }));
    expect(
      await screen.findByRole("button", { name: "I have saved the codes" }),
    ).toBeTruthy();
    expect(voucherApi.exportAudit).toHaveBeenCalledWith("b1");
    expect(csv.downloadCsv).toHaveBeenCalledWith(
      expect.stringContaining("SECRET-ONCE"),
      expect.stringContaining("b1"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "I have saved the codes" }),
    );
    expect(screen.queryByText(/Your new codes are ready/)).toBeNull();
  });
  it("preserves issued codes and offers retry if export audit fails", async () => {
    vi.mocked(voucherApi.exportAudit).mockRejectedValue(
      new Error("Export unavailable"),
    );
    renderPage(<AdminVouchers />);
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    change("Business name", "Acme");
    submit();
    fireEvent.click(
      await screen.findByRole("button", { name: "Download codes CSV" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Export unavailable",
    );
    expect(csv.downloadCsv).not.toHaveBeenCalled();
  });
  it("shows API errors and allows closing a creation form", async () => {
    vi.mocked(voucherApi.batches).mockRejectedValue(new Error("No access"));
    renderPage(<AdminVouchers />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "No access",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Close form" }));
    expect(screen.queryByText("Generate codes")).toBeNull();
  });
  it("sends exact email/domain restrictions with local deadline normalized to ISO", async () => {
    const created = vi.fn();
    renderPage(<NewVoucherBatch onCreated={created} />);
    change("Business name", " Acme ");
    change("Order / reference", " INV-1 ");
    change("Number of codes", "2");
    change("Allowed eligibility domains", "ACME.com");
    change("Assigned employee emails", "A@acme.com\n");
    change("Redeem before", "2099-12-01T12:30");
    submit();
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(voucherApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: "Acme",
        reference: "INV-1",
        allowedDomains: ["acme.com"],
        employeeEmails: ["a@acme.com", ""],
        redeemBy: new Date("2099-12-01T12:30").toISOString(),
      }),
    );
  });
  it.each([
    ["Assigned employee emails", "a@acme.com", "one email line"],
    [
      "Assigned employee emails",
      Array(10).fill("a@acme.com").join("\n"),
      "only once",
    ],
    ["Number of codes", "0", "1–500"],
    ["Months of access", "121", "1–500"],
    ["Redeem before", "2000-01-01T10:00", "future"],
    ["Business name", "   ", "Enter the business"],
    ["Allowed eligibility domains", "*.acme.com", "exact domains"],
  ])("rejects invalid %s", async (label, value, message) => {
    renderPage(<NewVoucherBatch onCreated={vi.fn()} />);
    change("Business name", "Acme");
    change(label, value);
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain(message);
    expect(voucherApi.create).not.toHaveBeenCalled();
  });
  it("renders server creation errors without losing entered data", async () => {
    vi.mocked(voucherApi.create).mockRejectedValue(new Error("Conflict"));
    renderPage(<NewVoucherBatch onCreated={vi.fn()} />);
    change("Business name", "Acme");
    submit();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Conflict",
    );
    expect(screen.getByLabelText("Business name")).toHaveProperty(
      "value",
      "Acme",
    );
  });
  it("renders plus tier, deadline and missing-reference batches", async () => {
    vi.mocked(voucherApi.batches).mockResolvedValue([
      {
        ...batch,
        tierName: "premium_plus",
        reference: null,
        redeemBy: "2099-01-01T00:00:00Z",
      },
    ]);
    renderPage(<AdminVouchers />);
    expect(await screen.findByText("Premium+")).toBeTruthy();
    expect(screen.getByText("No reference")).toBeTruthy();
  });
  it("recovers pending codes after route unmount and sign-out/login, then clears them on acknowledgement", async () => {
    const first = renderPage(<AdminVouchers />);
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    change("Business name", "Acme");
    submit();
    await screen.findByText(/Your new codes are ready/);
    first.unmount();
    saveSession(null);
    expect(loadIssuedVouchers()).toBeNull();
    saveSession({
      accessToken: "test",
      refreshToken: null,
      expiresAt: 9999999999,
      email: "admin@example.com",
      isAdmin: true,
    });
    renderPage(<AdminVouchers />);
    expect(screen.getByText(/Your new codes are ready/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download codes CSV" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "I have saved the codes" }),
    );
    expect(loadIssuedVouchers()).toBeNull();
  });
  it("blocks generation if private recovery storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("No storage");
    });
    renderPage(<NewVoucherBatch onCreated={vi.fn()} />);
    change("Business name", "Acme");
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "cannot save pending",
    );
    expect(voucherApi.create).not.toHaveBeenCalled();
  });
  it("keeps newly issued codes visible if storage fails after issuance", async () => {
    vi.mocked(voucherApi.create).mockImplementation(async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("Storage full");
      });
      return issued;
    });
    renderPage(<AdminVouchers />);
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    change("Business name", "Acme");
    submit();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "batch was created",
    );
    fireEvent.click(screen.getByRole("button", { name: "Download codes CSV" }));
    expect(
      await screen.findByRole("button", { name: "I have saved the codes" }),
    ).toBeTruthy();
    expect(csv.downloadCsv).toHaveBeenCalledWith(
      expect.stringContaining("SECRET-ONCE"),
      expect.any(String),
    );
  });
  it("recovers the one-time response through back/forward and button navigation", async () => {
    function Navigation() {
      const navigate = useNavigate();
      return (
        <>
          <button onClick={() => navigate("/away")}>Leave by button</button>
          <button onClick={() => navigate(-1)}>History back</button>
          <button onClick={() => navigate(1)}>History forward</button>
        </>
      );
    }
    renderPage(
      <>
        <Navigation />
        <Routes>
          <Route path="/admin/vouchers" element={<AdminVouchers />} />
          <Route path="/away" element={<p>Other page</p>} />
        </Routes>
      </>,
      { route: "/admin/vouchers" },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
    change("Business name", "Acme");
    submit();
    await screen.findByText(/Your new codes are ready/);
    fireEvent.click(screen.getByRole("button", { name: "Leave by button" }));
    expect(screen.getByText("Other page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "History back" }));
    expect(screen.getByText(/Your new codes are ready/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "History forward" }));
    expect(screen.getByText("Other page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "History back" }));
    expect(
      screen.getByRole("button", { name: "Download codes CSV" }),
    ).toBeTruthy();
    expect(voucherApi.create).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "retains concurrent responses across remount in either completion order (%s)",
    async (reverse) => {
      let completeA!: (value: typeof issued) => void;
      let completeB!: (value: typeof issued) => void;
      vi.mocked(voucherApi.create)
        .mockReturnValueOnce(
          new Promise((resolve) => {
            completeA = resolve;
          }),
        )
        .mockReturnValueOnce(
          new Promise((resolve) => {
            completeB = resolve;
          }),
        );
      const first = renderPage(<AdminVouchers />);
      fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
      change("Business name", "Acme");
      submit();
      first.unmount();
      renderPage(<AdminVouchers />);
      fireEvent.click(screen.getByRole("button", { name: "Create batch" }));
      change("Business name", "Second team");
      submit();
      const second = {
        ...issued,
        batch: { ...batch, id: "b2", businessName: "Second team" },
        codes: [{ id: "v2", code: "SECOND-SECRET", employeeEmail: null }],
      };
      if (reverse) {
        await act(async () => completeB(second));
        await act(async () => completeA(issued));
      } else {
        await act(async () => completeA(issued));
        await act(async () => completeB(second));
      }
      for (let i = 0; i < 2; i++) {
        expect(
          screen.queryByRole("button", { name: "I have saved the codes" }),
        ).toBeNull();
        fireEvent.click(
          screen.getByRole("button", { name: "Download codes CSV" }),
        );
        fireEvent.click(
          await screen.findByRole("button", { name: "I have saved the codes" }),
        );
      }
      expect(loadIssuedVouchers()).toBeNull();
      expect(
        vi
          .mocked(csv.downloadCsv)
          .mock.calls.map((call) => call[0])
          .join("\n"),
      ).toContain("SECRET-ONCE");
      expect(
        vi
          .mocked(csv.downloadCsv)
          .mock.calls.map((call) => call[0])
          .join("\n"),
      ).toContain("SECOND-SECRET");
    },
  );
  it.each(GRANTABLE_TIERS)(
    "creates a $name voucher batch with a custom duration",
    async (tier) => {
      const onCreated = vi.fn();
      renderPage(<NewVoucherBatch onCreated={onCreated} />);
      change("Business name", "Coach partnership");
      change("Months of access", "19");
      change("Membership", tier.id);
      submit();
      await waitFor(() => expect(onCreated).toHaveBeenCalled());
      expect(voucherApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ tierName: tier.id, months: 19 }),
      );
    },
  );
  it("links visibly to coach/employee redemption and lists the actual coach plan", async () => {
    vi.mocked(voucherApi.batches).mockResolvedValue([
      { ...batch, tierName: "coach_pro", months: 24 },
    ]);
    renderPage(<AdminVouchers />);
    expect(await screen.findByText("Coach Pro")).toBeTruthy();
    expect(screen.getByText("24 months")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "employee redemption page" })
        .getAttribute("href"),
    ).toBe("/redeem");
  });
});

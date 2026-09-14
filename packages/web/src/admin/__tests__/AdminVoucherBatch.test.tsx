import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { renderPage } from "@/test-utils";
import { AdminVoucherBatch } from "../pages/AdminVoucherBatch";
import { voucherApi } from "../voucherApi";
import * as csv from "../voucherCsv";
import { batch, unused, redeemed } from "./voucherFixtures";
function page() {
  return renderPage(
    <Routes>
      <Route path="/admin/vouchers/:batchId" element={<AdminVoucherBatch />} />
    </Routes>,
    { route: "/admin/vouchers/b1" },
  );
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), {
    target: { value },
  });
}
async function ready() {
  page();
  await screen.findByText("Voucher activity");
}
describe("voucher batch detail", () => {
  beforeEach(() => {
    vi.spyOn(voucherApi, "detail").mockResolvedValue({
      batch,
      vouchers: [unused, redeemed],
    });
    vi.spyOn(voucherApi, "assign").mockResolvedValue(unused);
    vi.spyOn(voucherApi, "importAssignments").mockResolvedValue({ updated: 1 });
    vi.spyOn(voucherApi, "revoke").mockResolvedValue({ revoked: 1 });
    vi.spyOn(voucherApi, "exportAudit").mockResolvedValue({ recorded: true });
    vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());
  it("separates employee eligibility and membership account and searches/status filters", async () => {
    await ready();
    expect(
      screen.getByRole("columnheader", { name: "Verified eligibility email" }),
    ).toBeTruthy();
    expect(screen.getByText("pat@personal.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign EFGH" })).toBeNull();
    change("Search vouchers", "personal");
    expect(screen.queryByText("ABCD")).toBeNull();
    change("Voucher status", "unused");
    expect(screen.getByText("No vouchers match these filters.")).toBeTruthy();
  });
  it("assigns a normalized employee email and clears restrictions", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Assign ABCD" }));
    change("Eligible employee email", " A@ACME.com ");
    fireEvent.submit(
      screen.getByRole("button", { name: "Save assignment" }).closest("form")!,
    );
    await waitFor(() =>
      expect(voucherApi.assign).toHaveBeenCalledWith("b1", "v1", "a@acme.com"),
    );
    expect(await screen.findByText("Employee assignment saved.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assign ABCD" }));
    fireEvent.submit(
      screen.getByRole("button", { name: "Save assignment" }).closest("form")!,
    );
    await waitFor(() =>
      expect(voucherApi.assign).toHaveBeenLastCalledWith("b1", "v1", null),
    );
  });
  it.each([
    ["pat@acme.com", "already assigned"],
    ["a@wrong.com", "allowed domains"],
  ])("rejects assignment %s", async (email, message) => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Assign ABCD" }));
    change("Eligible employee email", email);
    fireEvent.submit(
      screen.getByRole("button", { name: "Save assignment" }).closest("form")!,
    );
    expect(screen.getByRole("alert").textContent).toContain(message);
    expect(voucherApi.assign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Save assignment")).toBeNull();
  });
  it("requires a reason and distinguishes unused revocation from cancelling memberships", async () => {
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Revoke unused codes" }),
    );
    expect(screen.getByText(/does not cancel memberships/)).toBeTruthy();
    change("Audit reason", "x");
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Confirm revocation" })
        .closest("form")!,
    );
    expect(screen.getByRole("alert").textContent).toContain("at least 3");
    change("Audit reason", "Business cancelled order");
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Confirm revocation" })
        .closest("form")!,
    );
    await waitFor(() =>
      expect(voucherApi.revoke).toHaveBeenCalledWith(
        "b1",
        "Business cancelled order",
        undefined,
      ),
    );
    expect(
      await screen.findByText(/Existing memberships are unchanged/),
    ).toBeTruthy();
  });
  it("can revoke one code and cancel without mutating", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Revoke ABCD" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(voucherApi.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke ABCD" }));
    change("Audit reason", "Replace damaged card");
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Confirm revocation" })
        .closest("form")!,
    );
    await waitFor(() =>
      expect(voucherApi.revoke).toHaveBeenCalledWith(
        "b1",
        "Replace damaged card",
        "v1",
      ),
    );
  });
  it("previews and atomically applies imported assignments", async () => {
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Import employee assignments" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Download assignment template" }),
    );
    expect(csv.downloadCsv).toHaveBeenCalledWith(
      expect.stringContaining('"v1"'),
      expect.stringContaining("assignments"),
    );
    change("Or paste CSV", "voucherId,employeeEmail\nv1,");
    fireEvent.click(screen.getByRole("button", { name: "Validate CSV" }));
    expect(screen.getByRole("status").textContent).toContain(
      "1 assignments validated; 1",
    );
    expect(voucherApi.importAssignments).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply assignments" }));
    await waitFor(() =>
      expect(voucherApi.importAssignments).toHaveBeenCalledWith("b1", [
        { voucherId: "v1", employeeEmail: null },
      ]),
    );
    expect(await screen.findByText("1 assignments imported.")).toBeTruthy();
  });
  it("rejects invalid CSV then invalidates preview after edits", async () => {
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Import employee assignments" }),
    );
    change("Or paste CSV", "bad");
    fireEvent.click(screen.getByRole("button", { name: "Validate CSV" }));
    expect(screen.getByRole("alert").textContent).toContain("exactly");
    change("Or paste CSV", "voucherId,employeeEmail\nv1,a@acme.com");
    fireEvent.click(screen.getByRole("button", { name: "Validate CSV" }));
    change("Or paste CSV", "changed");
    expect(
      screen.queryByRole("button", { name: "Apply assignments" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
  it("uploads CSV and rejects oversized/read-failing files", async () => {
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Import employee assignments" }),
    );
    const input = screen.getByLabelText("CSV file");
    fireEvent.change(input, { target: { files: [] } });
    fireEvent.change(input, {
      target: {
        files: [
          {
            size: 1,
            text: async () => "voucherId,employeeEmail\nv1,a@acme.com",
          },
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Or paste CSV")).toHaveProperty(
        "value",
        expect.stringContaining("v1"),
      ),
    );
    fireEvent.change(input, { target: { files: [{ size: 2000000 }] } });
    expect(screen.getByRole("alert").textContent).toContain("1 MB");
    fireEvent.change(input, {
      target: {
        files: [
          {
            size: 1,
            text: async () => {
              throw new Error("Read failed");
            },
          },
        ],
      },
    });
    expect((await screen.findByRole("alert")).textContent).toBe("Read failed");
  });
  it("surfaces atomic-import conflicts and keeps the form for correction", async () => {
    vi.mocked(voucherApi.importAssignments).mockRejectedValue(
      new Error("Already redeemed"),
    );
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Import employee assignments" }),
    );
    change("Or paste CSV", "voucherId,employeeEmail\nv1,a@acme.com");
    fireEvent.click(screen.getByRole("button", { name: "Validate CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply assignments" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Already redeemed",
    );
    expect(
      screen.getByRole("button", { name: "Apply assignments" }),
    ).toBeTruthy();
  });
  it("audits metadata export and handles export failure", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Export audit CSV" }));
    expect(
      await screen.findByText(/Audit CSV download requested/),
    ).toBeTruthy();
    expect(csv.downloadCsv).toHaveBeenCalledWith(
      expect.stringContaining("pat@personal.com"),
      expect.stringContaining("audit"),
    );
    vi.mocked(voucherApi.exportAudit).mockRejectedValue(
      new Error("Export failed"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export audit CSV" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Export failed",
    );
  });
  it("shows missing details errors", async () => {
    vi.mocked(voucherApi.detail).mockRejectedValue(new Error("Not found"));
    page();
    expect((await screen.findByRole("alert")).textContent).toBe("Not found");
  });
  it("shows open restrictions and plus tier; assigned unused code is editable", async () => {
    vi.mocked(voucherApi.detail).mockResolvedValue({
      batch: {
        ...batch,
        tierName: "premium_plus",
        allowedDomains: [],
        reference: null,
        redeemBy: "2099-01-01T00:00:00Z",
      },
      vouchers: [{ ...unused, employeeEmail: "a@else.com" }],
    });
    await ready();
    expect(screen.getByText(/Open — any/)).toBeTruthy();
    expect(screen.getByText(/Premium\+/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assign ABCD" }));
    expect(
      screen.getByLabelText("Eligible employee email", { exact: false }),
    ).toHaveProperty("value", "a@else.com");
  });
  it("shows a coach batch plan, duration and redemption guidance", async () => {
    vi.mocked(voucherApi.detail).mockResolvedValue({
      batch: { ...batch, tierName: "individual_trainer", months: 21 },
      vouchers: [unused],
    });
    await ready();
    expect(screen.getByText(/Start Up Coach · 21 months/)).toBeTruthy();
    expect(
      screen.getByText(/Coach access is provisioned automatically/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "employee redemption page" })
        .getAttribute("href"),
    ).toBe("/redeem");
  });
});

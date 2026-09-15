import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { BatchIssuance } from "../BatchIssuance";
import { voucherApi } from "../voucherApi";
import { saveSession } from "../adminAuth";
import {
  loadIssuedVouchers,
  prepareIssuedStorage,
  saveIssuedVouchers,
} from "../issuedVouchers";
import * as csv from "../voucherCsv";
import { batch } from "./voucherFixtures";
const fresh = {
  batch: { ...batch, counts: { ...batch.counts, issued: 4, unused: 3 } },
  codes: [
    { id: "new1", code: "FRESH-ONE", employeeEmail: null },
    { id: "new2", code: "FRESH-TWO", employeeEmail: null },
  ],
};
const onIssued = vi.fn();
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), {
    target: { value },
  });
}
function submit() {
  fireEvent.submit(
    screen.getByRole("button", { name: "Generate new codes" }).closest("form")!,
  );
}
beforeEach(() => {
  sessionStorage.clear();
  saveSession({
    accessToken: "token",
    refreshToken: null,
    expiresAt: 9999999999,
    email: "admin@example.com",
    isAdmin: true,
  });
  onIssued.mockClear();
  vi.spyOn(voucherApi, "issue").mockResolvedValue(fresh);
  vi.spyOn(voucherApi, "exportAudit").mockResolvedValue({ recorded: true });
  vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it("adds new codes to the same batch, downloads only that set and hides it after acknowledgement", async () => {
  const view = renderPage(<BatchIssuance batch={batch} onIssued={onIssued} />);
  change("Number of new codes", "2");
  submit();
  await screen.findByText(/2 codes generated for Acme/);
  expect(voucherApi.issue).toHaveBeenCalledWith("b1", {
    quantity: 2,
    employeeEmails: undefined,
  });
  expect(onIssued).toHaveBeenCalledWith(fresh.batch);
  expect(
    screen.queryByRole("button", { name: "Generate new codes" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Download codes CSV" }));
  const ack = await screen.findByRole("button", {
    name: "I have saved the codes",
  });
  expect(csv.downloadCsv).toHaveBeenCalledWith(
    expect.stringContaining("FRESH-ONE"),
    expect.stringContaining("new1"),
  );
  fireEvent.click(ack);
  expect(loadIssuedVouchers("b1")).toBeNull();
  view.unmount();
  renderPage(<BatchIssuance batch={fresh.batch} onIssued={onIssued} />);
  expect(
    screen.queryByRole("button", { name: "Download codes CSV" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Generate new codes" }),
  ).toBeTruthy();
});
it("normalizes optional employee assignments and supports empty lines", async () => {
  renderPage(<BatchIssuance batch={batch} onIssued={onIssued} />);
  change("Number of new codes", "3");
  change("Assigned employee emails", " A@ACME.COM \n\nb@acme.com");
  submit();
  await screen.findByText(/codes generated/);
  expect(voucherApi.issue).toHaveBeenCalledWith("b1", {
    quantity: 3,
    employeeEmails: ["a@acme.com", "", "b@acme.com"],
  });
});
it.each([
  ["Number of new codes", "0", "between 1 and 500"],
  ["Number of new codes", "501", "between 1 and 500"],
  ["Number of new codes", "1.5", "between 1 and 500"],
  ["Assigned employee emails", "a@acme.com", "one email line"],
  [
    "Assigned employee emails",
    Array(10).fill("a@acme.com").join("\n"),
    "only once",
  ],
  ["Assigned employee emails", "a@elsewhere.com", "allowed domains"],
])("rejects invalid %s input", async (label, value, message) => {
  renderPage(<BatchIssuance batch={batch} onIssued={onIssued} />);
  change(label, value);
  submit();
  expect((await screen.findByRole("alert")).textContent).toContain(message);
  expect(voucherApi.issue).not.toHaveBeenCalled();
});
it("retains input on server failure and allows another attempt", async () => {
  vi.mocked(voucherApi.issue).mockRejectedValueOnce(
    new Error("This batch has expired."),
  );
  renderPage(<BatchIssuance batch={batch} onIssued={onIssued} />);
  change("Number of new codes", "2");
  submit();
  await screen.findByText("This batch has expired.");
  expect(screen.getByLabelText("Number of new codes")).toHaveProperty(
    "value",
    "2",
  );
  submit();
  await screen.findByText(/codes generated/);
});
it("does not offer generation for an expired batch", () => {
  renderPage(
    <BatchIssuance
      batch={{ ...batch, redeemBy: "2000-01-01T00:00:00Z" }}
      onIssued={onIssued}
    />,
  );
  expect(screen.getByText(/deadline has passed/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Generate new codes" }),
  ).toBeNull();
});
it("requires recovery storage before issuing codes", async () => {
  renderPage(<BatchIssuance batch={batch} onIssued={onIssued} />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("unavailable");
  });
  submit();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "cannot save pending",
  );
  expect(voucherApi.issue).not.toHaveBeenCalled();
});
it("keeps returned codes downloadable if recovery storage fails after issuance", async () => {
  vi.mocked(voucherApi.issue).mockImplementationOnce(async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("unavailable");
    });
    return fresh;
  });
  renderPage(<BatchIssuance batch={batch} onIssued={onIssued} />);
  submit();
  await screen.findByText(/browser recovery storage failed/);
  fireEvent.click(screen.getByRole("button", { name: "Download codes CSV" }));
  await waitFor(() => expect(csv.downloadCsv).toHaveBeenCalled());
});
it("recovers queued issuances independently and requires a new download for the next set", async () => {
  const owner = prepareIssuedStorage();
  saveIssuedVouchers(owner, fresh);
  saveIssuedVouchers(owner, {
    ...fresh,
    codes: [{ id: "later", code: "LATER-ONLY", employeeEmail: null }],
  });
  renderPage(<BatchIssuance batch={batch} onIssued={onIssued} />);
  fireEvent.click(screen.getByRole("button", { name: "Download codes CSV" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "I have saved the codes" }),
  );
  expect(screen.getByText(/1 code generated/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "I have saved the codes" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Download codes CSV" }));
  await screen.findByRole("button", { name: "I have saved the codes" });
  const latest = vi.mocked(csv.downloadCsv).mock.calls.at(-1)![0];
  expect(latest).toContain("LATER-ONLY");
  expect(latest).not.toContain("FRESH-ONE");
});

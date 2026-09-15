import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { IssuedBatch } from "../IssuedBatch";
import { voucherApi } from "../voucherApi";
import { saveSession } from "../adminAuth";
import {
  loadIssuedVouchers,
  prepareIssuedStorage,
  saveIssuedVouchers,
} from "../issuedVouchers";
import * as csv from "../voucherCsv";
import { batch } from "./voucherFixtures";
const issued = {
  batch,
  codes: [{ id: "new", code: "NEW-SECRET", employeeEmail: null }],
};
const onClose = vi.fn();
beforeEach(() => {
  sessionStorage.clear();
  saveSession({
    accessToken: "test",
    refreshToken: null,
    expiresAt: 9999999999,
    email: "admin@example.com",
    isAdmin: true,
  });
  saveIssuedVouchers(prepareIssuedStorage(), issued);
  vi.spyOn(voucherApi, "exportAudit").mockResolvedValue({ recorded: true });
  vi.spyOn(csv, "downloadCsv").mockImplementation(() => {});
  onClose.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it("blocks navigation while codes are pending, but allows a separate help tab", () => {
  renderPage(
    <>
      <IssuedBatch issued={issued} onClose={onClose} />
      <a href="/other">Leave</a>
      <a href="/support" target="_blank">
        Help
      </a>
    </>,
  );
  expect(fireEvent.click(screen.getByRole("link", { name: "Leave" }))).toBe(
    false,
  );
  expect(screen.getByRole("alert").textContent).toContain("before leaving");
  expect(fireEvent.click(screen.getByRole("link", { name: "Help" }))).toBe(
    true,
  );
  expect(loadIssuedVouchers()).toEqual(issued);
});
it("keeps codes recoverable on audit/download failure and permits retry", async () => {
  vi.mocked(voucherApi.exportAudit).mockRejectedValueOnce(
    new Error("Export unavailable"),
  );
  renderPage(<IssuedBatch issued={issued} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Download codes CSV" }));
  await screen.findByText("Export unavailable");
  expect(
    screen.queryByRole("button", { name: "I have saved the codes" }),
  ).toBeNull();
  expect(loadIssuedVouchers()).toEqual(issued);
  fireEvent.click(screen.getByRole("button", { name: "Download codes CSV" }));
  await screen.findByRole("button", { name: "I have saved the codes" });
  expect(csv.downloadCsv).toHaveBeenCalledTimes(1);
});
it("does not dismiss or lose a pending receipt when clearing storage fails", async () => {
  renderPage(<IssuedBatch issued={issued} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Download codes CSV" }));
  const ack = await screen.findByRole("button", {
    name: "I have saved the codes",
  });
  const remove = vi
    .spyOn(Storage.prototype, "removeItem")
    .mockImplementation(() => {
      throw new Error("unavailable");
    });
  fireEvent.click(ack);
  expect(screen.getByRole("alert").textContent).toContain(
    "Could not clear pending",
  );
  expect(onClose).not.toHaveBeenCalled();
  remove.mockRestore();
  expect(loadIssuedVouchers()).toEqual(issued);
  fireEvent.click(ack);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(loadIssuedVouchers()).toBeNull();
});

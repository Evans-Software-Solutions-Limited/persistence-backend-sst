import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSession } from "../adminAuth";
import {
  clearIssuedVouchers,
  loadIssuedVouchers,
  prepareIssuedStorage,
  saveIssuedVouchers,
  voucherIssuanceOwner,
} from "../issuedVouchers";
import { batch } from "./voucherFixtures";
const session = {
  accessToken: "test",
  refreshToken: null,
  expiresAt: 9999999999,
  email: "admin@example.com",
  isAdmin: true,
};
const issued = {
  batch,
  codes: [{ id: "v1", code: "PRIVATE-CODE", employeeEmail: null }],
};
describe("pending issuance recovery", () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveSession(session);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    vi.useRealTimers();
  });
  it("recovers only for the issuing administrator and clears on acknowledgement", () => {
    const owner = prepareIssuedStorage();
    saveIssuedVouchers(owner, issued);
    expect(loadIssuedVouchers()).toEqual(issued);
    saveSession({ ...session, email: "other@example.com" });
    expect(loadIssuedVouchers()).toBeNull();
    saveSession(null);
    expect(loadIssuedVouchers()).toBeNull();
    saveSession(session);
    expect(loadIssuedVouchers()).toEqual(issued);
    clearIssuedVouchers(issued.batch.id, issued.codes[0].id);
    expect(loadIssuedVouchers()).toBeNull();
  });
  it("uses immutable JWT subject when available", () => {
    saveSession({
      ...session,
      accessToken: `a.${btoa(JSON.stringify({ sub: "account-id" }))}.c`,
    });
    expect(voucherIssuanceOwner()).toBe("account-id");
  });
  it("expires and removes the recovery copy after 24 hours", () => {
    vi.useFakeTimers();
    saveIssuedVouchers(prepareIssuedStorage(), issued);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(loadIssuedVouchers()).toBeNull();
    expect(
      sessionStorage.getItem(
        "persistence.admin.pending-vouchers.admin%40example.com:b1:v1",
      ),
    ).toBeNull();
  });
  it("ignores corrupt recovery data", () => {
    const owner = prepareIssuedStorage();
    sessionStorage.setItem(
      `persistence.admin.pending-vouchers.${encodeURIComponent(owner)}:b1`,
      "invalid json",
    );
    expect(loadIssuedVouchers()).toBeNull();
    sessionStorage.setItem(
      `persistence.admin.pending-vouchers.${encodeURIComponent(owner)}:b1`,
      JSON.stringify({ version: 2 }),
    );
    expect(loadIssuedVouchers()).toBeNull();
  });
  it("refuses issuance without a signed-in admin identity", () => {
    saveSession({ ...session, isAdmin: false });
    expect(() => prepareIssuedStorage()).toThrow("Sign in again");
  });
  it.each([false, true])(
    "preserves two in-flight batch responses in either order (%s)",
    (reverse) => {
      const owner = prepareIssuedStorage();
      const other = {
        ...issued,
        batch: { ...batch, id: "b2" },
        codes: [{ id: "v2", code: "OTHER-CODE", employeeEmail: null }],
      };
      for (const receipt of reverse ? [other, issued] : [issued, other])
        saveIssuedVouchers(owner, receipt);
      const first = loadIssuedVouchers()!;
      clearIssuedVouchers(first.batch.id, first.codes[0].id);
      const second = loadIssuedVouchers()!;
      expect(new Set([first.batch.id, second.batch.id])).toEqual(
        new Set(["b1", "b2"]),
      );
      expect(new Set([first.codes[0].code, second.codes[0].code])).toEqual(
        new Set(["PRIVATE-CODE", "OTHER-CODE"]),
      );
    },
  );
});

it("keeps same-batch issuances separate and clears only the acknowledged set", () => {
  sessionStorage.clear();
  saveSession(session);
  const owner = prepareIssuedStorage();
  const second = {
    ...issued,
    codes: [{ id: "v3", code: "FRESH-CODE", employeeEmail: null }],
  };
  saveIssuedVouchers(owner, issued);
  saveIssuedVouchers(owner, second);
  expect(loadIssuedVouchers("b1")).toEqual(issued);
  clearIssuedVouchers("b1", "v1");
  expect(loadIssuedVouchers("b1")).toEqual(second);
  expect(loadIssuedVouchers("b2")).toBeNull();
  clearIssuedVouchers("b1", "v3");
  expect(loadIssuedVouchers()).toBeNull();
  sessionStorage.clear();
});

it("can acknowledge a legacy receipt without removing a fresh set in the same batch", () => {
  sessionStorage.clear();
  saveSession(session);
  const owner = prepareIssuedStorage();
  sessionStorage.setItem(
    `persistence.admin.pending-vouchers.${encodeURIComponent(owner)}:b1`,
    JSON.stringify({ version: 1, savedAt: Date.now(), ...issued }),
  );
  const second = {
    ...issued,
    codes: [{ id: "v3", code: "FRESH-CODE", employeeEmail: null }],
  };
  saveIssuedVouchers(owner, second);
  clearIssuedVouchers("b1", "v1");
  expect(loadIssuedVouchers()).toEqual(second);
  sessionStorage.clear();
});

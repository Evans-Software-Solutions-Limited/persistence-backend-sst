import type { VoucherBatch, Voucher } from "../voucherApi";
export const batch: VoucherBatch = {
  id: "b1",
  businessName: "Acme",
  reference: "INV-1",
  tierName: "premium",
  months: 12,
  allowedDomains: ["acme.com"],
  redeemBy: null,
  createdAt: "2026-09-01T12:00:00Z",
  counts: { issued: 2, unused: 1, redeemed: 1, expired: 0, revoked: 0 },
};
export const unused: Voucher = {
  id: "v1",
  batchId: "b1",
  codeHint: "ABCD",
  employeeEmail: null,
  status: "unused",
  eligibilityEmail: null,
  accountEmail: null,
  accountId: null,
  redeemedAt: null,
  expiresAt: null,
};
export const redeemed: Voucher = {
  ...unused,
  id: "v2",
  codeHint: "EFGH",
  employeeEmail: "pat@acme.com",
  status: "redeemed",
  eligibilityEmail: "pat@acme.com",
  accountEmail: "pat@personal.com",
  accountId: "account2",
  redeemedAt: "2026-09-01T12:00:00Z",
  expiresAt: "2027-09-01T12:00:00Z",
};

import type { GrantableTierId } from "@persistence/subscription-catalog";
import { adminFetch } from "./adminApi";

export type VoucherStatus = "unused" | "redeemed" | "expired" | "revoked";
export interface VoucherBatch {
  id: string;
  businessName: string;
  reference: string | null;
  tierName: GrantableTierId;
  months: number;
  allowedDomains: string[];
  redeemBy: string | null;
  createdAt: string;
  counts: {
    issued: number;
    unused: number;
    redeemed: number;
    expired: number;
    revoked: number;
  };
}
export interface Voucher {
  id: string;
  batchId: string;
  codeHint: string;
  employeeEmail: string | null;
  status: VoucherStatus;
  eligibilityEmail: string | null;
  accountEmail: string | null;
  accountId: string | null;
  redeemedAt: string | null;
  expiresAt: string | null;
}
export interface IssuedCode {
  id: string;
  code: string;
  employeeEmail: string | null;
}
export interface CreateVoucherBatch {
  businessName: string;
  reference?: string;
  quantity: number;
  tierName: VoucherBatch["tierName"];
  months: number;
  allowedDomains: string[];
  redeemBy: string | null;
  employeeEmails?: string[];
}
export interface Assignment {
  voucherId: string;
  employeeEmail: string | null;
}
async function request<T>(path: string, body?: unknown, method = "POST") {
  return (
    await adminFetch<{ data: T }>(
      `/admin/voucher-batches${path}`,
      body === undefined ? undefined : { method, body: JSON.stringify(body) },
    )
  ).data;
}
const idPath = (id: string) => `/${encodeURIComponent(id)}`;
export const voucherApi = {
  batches: (q = "") => request<VoucherBatch[]>(`?q=${encodeURIComponent(q)}`),
  create: (input: CreateVoucherBatch) =>
    request<{ batch: VoucherBatch; codes: IssuedCode[] }>("", input),
  detail: (id: string) =>
    request<{ batch: VoucherBatch; vouchers: Voucher[] }>(idPath(id)),
  assign: (batchId: string, voucherId: string, employeeEmail: string | null) =>
    request<Voucher>(
      `${idPath(batchId)}/vouchers${idPath(voucherId)}`,
      { employeeEmail },
      "PATCH",
    ),
  importAssignments: (id: string, assignments: Assignment[]) =>
    request<{ updated: number }>(`${idPath(id)}/assignments`, { assignments }),
  revoke: (id: string, reason: string, voucherId?: string) =>
    request<{ revoked: number }>(
      `${idPath(id)}${voucherId ? `/vouchers${idPath(voucherId)}` : ""}/revoke`,
      { reason },
    ),
  exportAudit: (id: string) =>
    request<{ recorded: true }>(`${idPath(id)}/export-audit`, {}),
};

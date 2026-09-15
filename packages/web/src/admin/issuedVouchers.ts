import { decodeJwtPayload, loadSession } from "./adminAuth";
import type { IssuedCode, VoucherBatch } from "./voucherApi";
export type IssuedVouchers = {
  batch: VoucherBatch;
  codes: IssuedCode[];
  storageWarning?: string;
};
const PREFIX = "persistence.admin.pending-vouchers.";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export function voucherIssuanceOwner(): string {
  const session = loadSession();
  const sub = session ? decodeJwtPayload(session.accessToken)?.sub : null;
  const owner =
    typeof sub === "string" ? sub : session?.email?.trim().toLowerCase();
  if (!session?.isAdmin || !owner)
    throw new Error("Sign in again before generating voucher codes.");
  return owner;
}
const ownerPrefix = (owner: string) => PREFIX + encodeURIComponent(owner) + ":";
const key = (owner: string, batchId: string, issuanceId: string) =>
  ownerPrefix(owner) +
  encodeURIComponent(batchId) +
  ":" +
  encodeURIComponent(issuanceId);
export const ISSUED_VOUCHERS_CHANGED = "persistence:pending-vouchers-changed";
/** Ensure private per-tab recovery is available before issuing unrecoverable codes. */
export function prepareIssuedStorage(): string {
  const owner = voucherIssuanceOwner();
  const probe = PREFIX + "storage-probe";
  try {
    sessionStorage.setItem(probe, "ready");
    sessionStorage.removeItem(probe);
  } catch {
    throw new Error(
      "This browser cannot save pending voucher codes. Allow session storage or use another browser before creating the batch.",
    );
  }
  return owner;
}
export function saveIssuedVouchers(owner: string, issued: IssuedVouchers) {
  sessionStorage.setItem(
    key(owner, issued.batch.id, issued.codes[0].id),
    JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      batch: issued.batch,
      codes: issued.codes,
    }),
  );
  window.dispatchEvent(new Event(ISSUED_VOUCHERS_CHANGED));
}
/** Only the same signed-in administrator can resume this tab's pending downloads. */
export function loadIssuedVouchers(batchId?: string): IssuedVouchers | null {
  try {
    const prefix = ownerPrefix(voucherIssuanceOwner());
    const keys = Object.keys(sessionStorage).filter((k) =>
      k.startsWith(prefix),
    );
    const receipts: (IssuedVouchers & { savedAt: number })[] = [];
    for (const storageKey of keys) {
      try {
        const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (
          parsed?.version !== 1 ||
          typeof parsed.savedAt !== "number" ||
          Date.now() - parsed.savedAt > MAX_AGE_MS ||
          !parsed.batch?.id ||
          !Array.isArray(parsed.codes) ||
          !parsed.codes.length ||
          parsed.codes.length > 500 ||
          parsed.codes.some(
            (c: IssuedCode) =>
              typeof c.code !== "string" || typeof c.id !== "string",
          )
        ) {
          sessionStorage.removeItem(storageKey);
          continue;
        }
        if (!batchId || parsed.batch.id === batchId) receipts.push(parsed);
      } catch {
        sessionStorage.removeItem(storageKey);
      }
    }
    receipts.sort((a, b) => a.savedAt - b.savedAt);
    const first = receipts[0];
    return first ? { batch: first.batch, codes: first.codes } : null;
  } catch {
    return null;
  }
}
/** Clear only the acknowledged issuance, including receipts from the older key format. */
export function clearIssuedVouchers(batchId: string, issuanceId: string) {
  const prefix = ownerPrefix(voucherIssuanceOwner());
  for (const storageKey of Object.keys(sessionStorage).filter((k) =>
    k.startsWith(prefix),
  )) {
    let receipt;
    try {
      receipt = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    } catch {
      continue;
    }
    if (
      receipt?.batch?.id === batchId &&
      receipt?.codes?.[0]?.id === issuanceId
    )
      sessionStorage.removeItem(storageKey);
  }
  window.dispatchEvent(new Event(ISSUED_VOUCHERS_CHANGED));
}

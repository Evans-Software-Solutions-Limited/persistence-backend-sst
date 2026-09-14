import type { GrantableTierId } from "@persistence/subscription-catalog";
import { createHash, randomBytes } from "node:crypto";
export class VoucherError extends Error {
  readonly code: string;
  readonly status: 400 | 401 | 404 | 409 | 429 | 503;
  constructor(
    code = "invalid_voucher",
    status: VoucherError["status"] = 400,
    message = "Unable to use this voucher or verification. Check your details and try again.",
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new VoucherError("invalid_email");
  return email;
}
export function normalizeDomains(values: string[]): string[] {
  if (values.length > 50) throw new VoucherError("invalid_domains");
  return [
    ...new Set(
      values.map((v) => {
        const d = v.trim().toLowerCase();
        if (
          d.length > 253 ||
          !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)
        )
          throw new VoucherError("invalid_domains");
        return d;
      }),
    ),
  ];
}
export function eligible(
  email: string,
  domains: string[],
  exact: string | null,
): boolean {
  return (
    (!exact || email === exact) &&
    (!domains.length || domains.includes(email.split("@")[1]))
  );
}
export function generateCode(): string {
  return `PERSIST-${randomBytes(16).toString("hex").toUpperCase()}`;
}
export function canonicalCode(code: string): string {
  return code.trim().toUpperCase();
}
export interface BatchInput {
  businessName: string;
  reference?: string;
  quantity: number;
  tierName: GrantableTierId;
  months: number;
  allowedDomains: string[];
  redeemBy: string | null;
  employeeEmails?: string[];
}

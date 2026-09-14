import { membershipTierLabel } from "@/lib/membershipTier";
import type {
  Assignment,
  IssuedCode,
  Voucher,
  VoucherBatch,
} from "./voucherApi";

/** Quote every cell and neutralise formulas even after leading whitespace. */
export function csvCell(value: string | number | null): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export const toCsv = (rows: (string | number | null)[][]) =>
  "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
export function distributionCsv(batch: VoucherBatch, codes: IssuedCode[]) {
  return toCsv([
    [
      "voucherId",
      "code",
      "employeeEmail",
      "business",
      "tier",
      "membership",
      "months",
      "allowedDomains",
      "redeemBy",
      "redeemUrl",
    ],
    ...codes.map((code) => [
      code.id,
      code.code,
      code.employeeEmail,
      batch.businessName,
      batch.tierName,
      membershipTierLabel(batch.tierName),
      batch.months,
      batch.allowedDomains.join(";"),
      batch.redeemBy,
      `${window.location.origin}/redeem`,
    ]),
  ]);
}
export function auditCsv(vouchers: Voucher[]) {
  return toCsv([
    [
      "voucherId",
      "codeHint",
      "employeeEmail",
      "status",
      "eligibilityEmail",
      "accountEmail",
      "accountId",
      "redeemedAt",
      "expiresAt",
    ],
    ...vouchers.map((v) => [
      v.id,
      v.codeHint,
      v.employeeEmail,
      v.status,
      v.eligibilityEmail,
      v.accountEmail,
      v.accountId,
      v.redeemedAt,
      v.expiresAt,
    ]),
  ]);
}
export function downloadCsv(contents: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start reading the blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function parseDomains(value: string): string[] {
  const domains = [
    ...new Set(
      value
        .toLowerCase()
        .split(/[\s,;]+/)
        .filter(Boolean),
    ),
  ];
  if (
    domains.length > 50 ||
    domains.some(
      (d) =>
        d.length > 253 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(d),
    )
  )
    throw new Error(
      "Enter up to 50 exact domains, such as company.com. Do not include @, URLs or wildcards.",
    );
  return domains;
}
export function normaliseEmployeeEmail(
  value: string,
  domains: string[],
): string | null {
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error(`Invalid employee email: ${email}`);
  if (domains.length && !domains.includes(email.split("@")[1]))
    throw new Error(`${email} does not match this batch's allowed domains.`);
  return email;
}
/** Small RFC 4180 reader: quoted commas/newlines/escaped quotes, no silent malformed rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
        if (c === "\r" && source[i + 1] === "\n") i++;
      }
    } else if (c === '"' && cell === "" && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error("Malformed CSV quoting.");
      cell += c;
    }
  }
  if (quoted) throw new Error("Unclosed quote in CSV.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function parseAssignments(
  text: string,
  vouchers: Voucher[],
  domains: string[],
): Assignment[] {
  const [header, ...rows] = parseCsv(text);
  if (
    !header ||
    header.length !== 2 ||
    header[0].trim() !== "voucherId" ||
    header[1].trim() !== "employeeEmail"
  )
    throw new Error(
      "CSV must have exactly these columns: voucherId,employeeEmail.",
    );
  if (!rows.length || rows.length > 500)
    throw new Error("Import between 1 and 500 assignments.");
  const ids = new Set<string>();
  const assignments = rows.map((row, index) => {
    if (row.length !== 2)
      throw new Error(`Row ${index + 2}: expected two columns.`);
    const voucherId = row[0].trim();
    const voucher = vouchers.find((v) => v.id === voucherId);
    if (!voucher || voucher.status !== "unused")
      throw new Error(
        `Row ${index + 2}: voucher must belong to this batch and be unused.`,
      );
    if (ids.has(voucherId))
      throw new Error(`Duplicate voucher ID: ${voucherId}`);
    ids.add(voucherId);
    // Undo only the formula-protection prefix we exported for this exact
    // existing assignment; never rewrite an arbitrary new email's local part.
    const cell =
      voucher.employeeEmail &&
      /^[=+\-@]/.test(voucher.employeeEmail) &&
      row[1] === `'${voucher.employeeEmail}`
        ? voucher.employeeEmail
        : row[1];
    return {
      voucherId,
      employeeEmail: normaliseEmployeeEmail(cell, domains),
    };
  });
  const assigned = new Set<string>();
  for (const voucher of vouchers) {
    const edit = assignments.find((a) => a.voucherId === voucher.id);
    const email = edit ? edit.employeeEmail : voucher.employeeEmail;
    if (email && assigned.has(email))
      throw new Error(`Duplicate employee email: ${email}`);
    if (email) assigned.add(email);
  }
  return assignments;
}

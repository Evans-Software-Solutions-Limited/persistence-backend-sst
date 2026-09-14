import { afterEach, describe, expect, it, vi } from "vitest";
import {
  csvCell,
  toCsv,
  parseCsv,
  parseAssignments,
  normaliseEmployeeEmail,
  parseDomains,
  distributionCsv,
  auditCsv,
  downloadCsv,
} from "../voucherCsv";
import { batch, unused, redeemed } from "./voucherFixtures";
describe("voucher CSV and restrictions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it.each([
    "=SUM(1,2)",
    " +run",
    "-cmd",
    "@formula",
    "\tvalue",
    "\rline",
    "\nline",
  ])("escapes spreadsheet formulas: %j", (value) => {
    expect(csvCell(value)).toBe(`"'${value}"`);
  });
  it("quotes delimiters, nulls and literal quotes", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe('""');
    expect(
      parseCsv(
        toCsv([
          ["one", 2],
          ["x,y", "a\nb"],
        ]),
      ),
    ).toEqual([
      ["one", "2"],
      ["x,y", "a\nb"],
    ]);
  });
  it("exports redemption URL without email or code query parameters and separates verified/account emails", () => {
    const csv = distributionCsv({ ...batch, businessName: "=unsafe" }, [
      { id: "v1", code: "ABC", employeeEmail: null },
    ]);
    expect(csv).toContain("'=unsafe");
    expect(csv).toContain(`${window.location.origin}/redeem`);
    expect(csv).not.toContain("?email");
    const audit = auditCsv([redeemed]);
    expect(audit).toContain("pat@acme.com");
    expect(audit).toContain("pat@personal.com");
    expect(audit).not.toContain('"code",');
  });
  it("normalises exact domains and treats empty restrictions as open", () => {
    expect(parseDomains("ACME.com, acme.com;staff.acme.com")).toEqual([
      "acme.com",
      "staff.acme.com",
    ]);
    expect(parseDomains("")).toEqual([]);
    expect(normaliseEmployeeEmail(" A@other.com ", [])).toBe("a@other.com");
    expect(normaliseEmployeeEmail("", [])).toBeNull();
  });
  it.each([
    "https://acme.com",
    "*.acme.com",
    "@acme.com",
    "acme..com",
    Array.from({ length: 51 }, (_, i) => `d${i}.com`).join(","),
  ])("rejects invalid domain restrictions %s", (value) => {
    expect(() => parseDomains(value)).toThrow("exact domains");
  });
  it.each(["user@sub.acme.com", "user@fakeacme.com"])(
    "rejects near matches %s",
    (email) =>
      expect(() => normaliseEmployeeEmail(email, ["acme.com"])).toThrow(
        "allowed domains",
      ),
  );
  it.each([
    "bad",
    "a@@acme.com",
    "a b@acme.com",
    "a".repeat(250) + "@acme.com",
  ])("rejects invalid email %s", (email) =>
    expect(() => normaliseEmployeeEmail(email, [])).toThrow(
      "Invalid employee email",
    ),
  );
  it("accepts mixed quoted CSV and CRLF", () =>
    expect(
      parseCsv('voucherId,employeeEmail\r\n"v1","a@acme.com"\r\n\n'),
    ).toEqual([
      ["voucherId", "employeeEmail"],
      ["v1", "a@acme.com"],
    ]));
  it.each(['"unfinished', '"done"x', 'some"thing'])(
    "rejects malformed CSV %s",
    (text) => expect(() => parseCsv(text)).toThrow(),
  );
  it("validates assignments atomically including clears", () =>
    expect(
      parseAssignments(
        "voucherId,employeeEmail\nv1,",
        [unused, redeemed],
        batch.allowedDomains,
      ),
    ).toEqual([{ voucherId: "v1", employeeEmail: null }]));
  it.each([
    ["", "exactly"],
    ["email,id\na,b", "exactly"],
    ["voucherId,employeeEmail\n", "between"],
    ["voucherId,employeeEmail\nv1,a,b", "two columns"],
    ["voucherId,employeeEmail\nv2,a@acme.com", "unused"],
    ["voucherId,employeeEmail\nmissing,a@acme.com", "unused"],
    [
      "voucherId,employeeEmail\nv1,a@acme.com\nv1,b@acme.com",
      "Duplicate voucher",
    ],
    ["voucherId,employeeEmail\nv1,pat@acme.com", "Duplicate employee"],
    ["voucherId,employeeEmail\nv1,a@else.com", "allowed domains"],
  ])("rejects invalid assignments %s", (csv, message) =>
    expect(() =>
      parseAssignments(csv, [unused, redeemed], batch.allowedDomains),
    ).toThrow(message),
  );
  it("handles empty rows, escaped quotes, LF and bare CR", () =>
    expect(parseCsv('a,b\r\n\r"a""b",c\nx,y')).toEqual([
      ["a", "b"],
      ['a"b', "c"],
      ["x", "y"],
    ]));
  it("downloads a blob with a bounded lifetime", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:test"),
      revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    downloadCsv("csv", "codes.csv");
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });
  it("round-trips formula-prefixed employee addresses in assignment templates", () => {
    const assigned = { ...unused, employeeEmail: "+employee@acme.com" };
    expect(
      parseAssignments(
        toCsv([
          ["voucherId", "employeeEmail"],
          [assigned.id, assigned.employeeEmail],
        ]),
        [assigned],
        batch.allowedDomains,
      ),
    ).toEqual([{ voucherId: "v1", employeeEmail: "+employee@acme.com" }]);
  });
  it("exports exact coach plan IDs, human labels and custom duration", () => {
    const rows = parseCsv(
      distributionCsv({ ...batch, tierName: "coach_pro", months: 23 }, [
        { id: "v1", code: "CODE", employeeEmail: null },
      ]),
    );
    expect(rows[1][rows[0].indexOf("tier")]).toBe("coach_pro");
    expect(rows[1][rows[0].indexOf("membership")]).toBe("Coach Pro");
    expect(rows[1][rows[0].indexOf("months")]).toBe("23");
  });
});

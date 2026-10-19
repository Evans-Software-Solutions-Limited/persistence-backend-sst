import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRADEDOUBLER_REPORT_URL,
  buildTradedoublerReportUrl,
  orderValueString,
  reportTradedoublerSale,
  tradedoublerConfig,
  validOnDate,
} from "../reportSale";

const SALE = {
  orderNumber: "cs_test_1",
  orderValueMinor: 11199,
  currency: "gbp",
  voucher: "BLC-TEST",
  tduid: "td_click_1",
  now: new Date("2026-10-19T12:00:00Z"),
};

const fetchMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

describe("reportTradedoublerSale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TRADEDOUBLER_ORGANIZATION_ID", "123456");
    vi.stubEnv("TRADEDOUBLER_SALE_EVENT_ID", "654321");
    vi.stubEnv("TRADEDOUBLER_VALID_ON_DAYS", "");
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("skips, with a log line, when the ids are not configured", async () => {
    vi.stubEnv("TRADEDOUBLER_ORGANIZATION_ID", "");
    expect(await reportTradedoublerSale(SALE)).toEqual({ skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("not configured"),
    );
    vi.stubEnv("TRADEDOUBLER_ORGANIZATION_ID", "123456");
    vi.stubEnv("TRADEDOUBLER_SALE_EVENT_ID", "  ");
    expect(await reportTradedoublerSale(SALE)).toEqual({ skipped: true });
  });

  it("GETs the report URL with exactly the documented parameters", async () => {
    const result = await reportTradedoublerSale(SALE);
    expect(result).toEqual({ skipped: false, ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; signal: AbortSignal },
    ];
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(TRADEDOUBLER_REPORT_URL);
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      organization: "123456",
      event: "654321",
      orderNumber: "cs_test_1",
      // Two decimals, `.` separator, no symbol — the documented format.
      orderValue: "111.99",
      currency: "GBP",
      voucher: "BLC-TEST",
      tduid: "td_click_1",
      // Fourteen days on by default: the refund window.
      validOn: "2026-11-02",
    });
    // No `type=iframe` — that is the pixel's parameter, not S2S.
    expect(parsed.searchParams.has("type")).toBe(false);
    expect(init.method).toBe("GET");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits tduid and voucher when they are empty", async () => {
    await reportTradedoublerSale({ ...SALE, tduid: "", voucher: "" });
    const parsed = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(parsed.searchParams.has("tduid")).toBe(false);
    expect(parsed.searchParams.has("voucher")).toBe(false);
  });

  it("honours a configured validOn window and ignores a bad one", async () => {
    vi.stubEnv("TRADEDOUBLER_VALID_ON_DAYS", "30");
    expect(tradedoublerConfig()?.validOnDays).toBe(30);
    await reportTradedoublerSale(SALE);
    expect(
      new URL(fetchMock.mock.calls[0]![0] as string).searchParams.get(
        "validOn",
      ),
    ).toBe("2026-11-18");
    vi.stubEnv("TRADEDOUBLER_VALID_ON_DAYS", "soon");
    expect(tradedoublerConfig()?.validOnDays).toBe(14);
    vi.stubEnv("TRADEDOUBLER_VALID_ON_DAYS", "-3");
    expect(tradedoublerConfig()?.validOnDays).toBe(14);
    vi.stubEnv("TRADEDOUBLER_VALID_ON_DAYS", "0");
    expect(tradedoublerConfig()?.validOnDays).toBe(0);
  });

  it("formats the money and the date the way Tradedoubler reads them", () => {
    expect(orderValueString(11199)).toBe("111.99");
    expect(orderValueString(1700)).toBe("17.00");
    expect(orderValueString(0)).toBe("0.00");
    expect(validOnDate(new Date("2026-12-25T23:30:00Z"), 14)).toBe(
      "2027-01-08",
    );
    expect(
      buildTradedoublerReportUrl(
        { organization: "1", event: "2", validOnDays: 1 },
        { ...SALE, now: undefined },
      ),
    ).toContain("validOn=");
  });

  it("reports a non-2xx answer without throwing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    expect(await reportTradedoublerSale(SALE)).toEqual({
      skipped: false,
      ok: false,
      status: 500,
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("HTTP 500"),
    );
  });

  it("reports a network failure without throwing", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    expect(await reportTradedoublerSale(SALE)).toEqual({
      skipped: false,
      ok: false,
      status: null,
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("ECONNRESET"),
    );
  });

  it("gives up after five seconds rather than holding the webhook", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: unknown, init: unknown) =>
        new Promise((_resolve, reject) => {
          (init as { signal: AbortSignal }).signal.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
          );
        }),
    );
    const pending = reportTradedoublerSale(SALE);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual({ skipped: false, ok: false, status: null });
  });
});

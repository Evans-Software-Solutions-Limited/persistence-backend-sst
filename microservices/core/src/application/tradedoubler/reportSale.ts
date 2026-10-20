import { getEnvOrDefault } from "@persistence/api-utils/env";

/**
 * Server-to-server sale report to Tradedoubler, the affiliate network behind
 * the Blue Light Card partnership.
 *
 * Docs: https://dev.tradedoubler.com/tracking/advertiser/ — the S2S request
 * takes the same parameters as the tracking pixel, minus `type=iframe`:
 *   `organization` (int), `event` (int), `orderNumber`, `orderValue` (two
 *   decimals, `.` separator, no symbols), `currency` (ISO-4217), `voucher`,
 *   `tduid` (the click id the redirect page stored) and `validOn`
 *   (`YYYY-MM-DD` — the date the transaction becomes approved, which the docs
 *   describe as ISO-8601 date only; confirmed against the parameter table on
 *   2026-10-19).
 *
 * ─── Fire and forget, never fail the webhook ───
 *
 * This is called from `checkout.session.completed`. A Tradedoubler outage must
 * not 500 the webhook and make Stripe redeliver a payment we have already
 * accepted — so nothing here throws. A failure is logged with its status and
 * reported in the return value; the caller decides whether to alert.
 *
 * Reporting is at most once per Session because the webhook claims the event
 * id before dispatching (`stripeIdempotency.ts`), and `orderNumber` is the
 * Session id so a duplicate on Tradedoubler's side would at least be visible.
 */

export const TRADEDOUBLER_REPORT_URL = "https://tbs.tradedoubler.com/report";

const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_VALID_ON_DAYS = 14;

export interface TradedoublerSale {
  /** Our transaction reference — the Stripe Checkout Session id. */
  orderNumber: string;
  /** Amount charged, in minor units. */
  orderValueMinor: number;
  /** ISO-4217, any case. */
  currency: string;
  /** The promotion code the member used. */
  voucher: string;
  /** Tradedoubler click id captured on the landing page; empty when absent. */
  tduid: string;
  /** Injectable for tests. */
  now?: Date;
}

export type TradedoublerReportResult =
  | { skipped: true }
  | { skipped: false; ok: boolean; status: number | null };

interface Config {
  organization: string;
  event: string;
  validOnDays: number;
}

export function tradedoublerConfig(): Config | null {
  const organization = getEnvOrDefault(
    "TRADEDOUBLER_ORGANIZATION_ID",
    "",
  ).trim();
  const event = getEnvOrDefault("TRADEDOUBLER_SALE_EVENT_ID", "").trim();
  if (organization.length === 0 || event.length === 0) return null;
  const parsedDays = Number.parseInt(
    getEnvOrDefault("TRADEDOUBLER_VALID_ON_DAYS", "").trim(),
    10,
  );
  return {
    organization,
    event,
    validOnDays:
      Number.isInteger(parsedDays) && parsedDays >= 0
        ? parsedDays
        : DEFAULT_VALID_ON_DAYS,
  };
}

/** `YYYY-MM-DD` in UTC, `days` ahead of `from`. */
export function validOnDate(from: Date, days: number): string {
  const d = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Minor units → Tradedoubler's `orderValue`: two decimals, `.` separator. */
export function orderValueString(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function buildTradedoublerReportUrl(
  config: Config,
  sale: TradedoublerSale,
): string {
  const url = new URL(TRADEDOUBLER_REPORT_URL);
  const params = url.searchParams;
  params.set("organization", config.organization);
  params.set("event", config.event);
  params.set("orderNumber", sale.orderNumber);
  params.set("orderValue", orderValueString(sale.orderValueMinor));
  params.set("currency", sale.currency.toUpperCase());
  if (sale.voucher.length > 0) params.set("voucher", sale.voucher);
  if (sale.tduid.length > 0) params.set("tduid", sale.tduid);
  params.set(
    "validOn",
    validOnDate(sale.now ?? new Date(), config.validOnDays),
  );
  return url.toString();
}

export async function reportTradedoublerSale(
  sale: TradedoublerSale,
): Promise<TradedoublerReportResult> {
  const config = tradedoublerConfig();
  if (config === null) {
    console.log("[tradedoubler] not configured — skipping");
    return { skipped: true };
  }

  const url = buildTradedoublerReportUrl(config, sale);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    if (res.ok) {
      console.log(
        `[tradedoubler] reported ${sale.orderNumber}: HTTP ${res.status}`,
      );
    } else {
      console.error(
        `[tradedoubler] report for ${sale.orderNumber} answered HTTP ${res.status}`,
      );
    }
    return { skipped: false, ok: res.ok, status: res.status };
  } catch (err) {
    console.error(
      `[tradedoubler] report for ${sale.orderNumber} failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { skipped: false, ok: false, status: null };
  } finally {
    clearTimeout(timer);
  }
}

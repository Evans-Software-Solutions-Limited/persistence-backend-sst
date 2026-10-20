import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";
import { marketingApiBase } from "@/lib/marketingApiBase";
import { trackPurchase } from "@/lib/metaPixel";
import {
  captureTduid,
  initTradedoubler,
  trackTradedoublerSale,
} from "@/lib/tradedoubler";
import { appDestination } from "@/lib/appDestination";
import {
  BLC_COPY,
  BLC_PATH,
  blcPlanContentId,
  blcTierName,
  formatBlcPrice,
  isBlcTier,
} from "@/marketing/blc/blcOffer";
import {
  BlueLightCardThanksPresenter,
  type BlcThanksView,
} from "@/marketing/blc/BlueLightCardThanksPresenter";

interface BlcCheckoutStatus {
  status: "open" | "completed" | "expired";
  tier: string;
  cadence: string;
  emailMasked: string;
  amountMinor: number;
  currency: string;
  eventId: string | null;
  /** The subscription is live, not merely paid for. */
  accessReady: boolean;
}

/** A session the API has no record of. Permanent — never worth retrying. */
class UnknownCheckout extends Error {}

async function loadStatus(sessionId: string): Promise<BlcCheckoutStatus> {
  const response = await fetch(
    `${marketingApiBase()}/blc/checkout/${encodeURIComponent(sessionId)}/status`,
  );
  if (response.status === 404) throw new UnknownCheckout();
  if (!response.ok) throw new Error("Status could not be loaded");
  const body = (await response.json()) as { data: BlcCheckoutStatus };
  return body.data;
}

/** How long an `open` checkout is polled before the page stops asking. */
const OPEN_POLL_WINDOW_MS = 2 * 60_000;
/** How long a paid-but-not-live checkout is polled for the subscription. */
const READY_POLL_WINDOW_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;

/**
 * Where Stripe returns a Blue Light Card buyer (PER-3). The same shape as
 * `FoundingThanks`, for the same reasons:
 *
 *  - It POLLS our record rather than trusting Stripe's redirect, because the
 *    subscription is created by the webhook, which can land a beat later.
 *    Polling is bounded so a left-open or bookmarked tab is not a slow leak.
 *  - The Meta `Purchase` carries the event id the SERVER already used, so the
 *    pair dedupes instead of double-counting; it fires once per page life.
 *  - The Tradedoubler sale fires once too, with the Checkout session id as the
 *    order number — the server reports the same sale with the same number and
 *    the network dedupes on it.
 *  - The session id is captured once and stripped from the address bar in a
 *    layout effect, before the pixel's PageView can read the location.
 */
export function BlueLightCardThanks() {
  const [params] = useSearchParams();
  const [sessionId] = useState(() => params.get("session_id") ?? "");
  const purchaseFired = useRef(false);
  const saleFired = useRef(false);
  const [openedAt] = useState(Date.now);

  useLayoutEffect(() => {
    if (!sessionId) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("session_id")) return;
    url.searchParams.delete("session_id");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [sessionId]);

  // The landing tag on the thanks page too: the SDK must be up for the
  // browser-side sale report, and this may be the first page a consenting
  // visitor opens after a cold return from Stripe.
  useEffect(() => {
    captureTduid();
    initTradedoubler();
  }, []);

  const status = useQuery({
    queryKey: ["blc", "checkout", sessionId],
    queryFn: () => loadStatus(sessionId),
    enabled: sessionId.length > 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      const age = Date.now() - openedAt;
      if (data?.status === "completed")
        return !data.accessReady && age < READY_POLL_WINDOW_MS
          ? POLL_INTERVAL_MS
          : false;
      if (data?.status !== "open") return false;
      return age < OPEN_POLL_WINDOW_MS ? POLL_INTERVAL_MS : false;
    },
    retry: (failureCount, error) =>
      !(error instanceof UnknownCheckout) && failureCount < 3,
  });

  useSeo({
    title: "Thank you — Persistence",
    description: "Your Blue Light Card member plan is being set up.",
    path: `${BLC_PATH}/thanks`,
    noindex: true,
  });

  const data = status.data;
  useEffect(() => {
    if (data?.status !== "completed") return;
    if (!purchaseFired.current && data.eventId) {
      purchaseFired.current = true;
      trackPurchase(
        data.eventId,
        data.amountMinor / 100,
        data.currency,
        blcPlanContentId(data.tier, data.cadence),
      );
    }
    if (!saleFired.current) {
      saleFired.current = true;
      trackTradedoublerSale({
        transactionId: sessionId,
        orderValue: data.amountMinor / 100,
        voucher: "",
        currency: data.currency,
      });
    }
  }, [data, sessionId]);

  // Paid, not live, and the page has given up waiting: say so, and say "do
  // not pay again". A timer rather than a render-time clock read, so the
  // flip happens once, when the polling window lapses.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (data?.status !== "completed" || data.accessReady) return;
    const remaining = READY_POLL_WINDOW_MS - (Date.now() - openedAt);
    const timer = window.setTimeout(
      () => setSlow(true),
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
  }, [data, openedAt]);

  const noSession = sessionId.length === 0;
  const unreachable = !noSession && status.isError;

  const view: BlcThanksView = {
    state: noSession
      ? "unfinished"
      : unreachable
        ? "unreachable"
        : data?.status === "completed"
          ? data.accessReady
            ? "complete"
            : "pending"
          : data === undefined || data.status === "open"
            ? "pending"
            : "unfinished",
    slow,
    planLine: data?.status === "completed" ? planLine(data) : "",
    emailMasked: data?.emailMasked ?? "",
    openAppHref: appDestination().href,
  };

  return (
    <MarketingLayout>
      <BlueLightCardThanksPresenter {...view} />
    </MarketingLayout>
  );
}

/** "Premium, annual, £111.99/yr" — the server's record, never the page's. */
function planLine(data: BlcCheckoutStatus): string {
  const name = isBlcTier(data.tier) ? blcTierName(data.tier) : data.tier;
  const unit = data.cadence === "annual" ? BLC_COPY.perYear : BLC_COPY.perMonth;
  return `${name}, ${data.cadence}, ${formatBlcPrice(data.amountMinor)}${unit}`;
}

export default BlueLightCardThanks;

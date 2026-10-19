import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";
import { AppStoreCta } from "@/marketing/AppStoreCta";
import { PlayStoreCta } from "@/marketing/PlayStoreCta";
import { marketingApiBase } from "@/lib/marketingApiBase";
import { trackPurchase } from "@/lib/metaPixel";
import {
  captureTduid,
  initTradedoubler,
  trackTradedoublerSale,
} from "@/lib/tradedoubler";
import { appDestination } from "@/lib/appDestination";
import { BLC_COPY, BLC_PATH, blcPlanContentId } from "@/marketing/blc/blcOffer";

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

  const noSession = sessionId.length === 0;
  const unreachable = !noSession && status.isError;
  const complete = !noSession && !unreachable && data?.status === "completed";

  const heading = noSession
    ? BLC_COPY.thanks.unfinishedHeading
    : unreachable
      ? BLC_COPY.thanks.unreachableHeading
      : data?.status === "completed"
        ? BLC_COPY.thanks.paidHeading
        : data === undefined || data.status === "open"
          ? BLC_COPY.thanks.pendingHeading
          : BLC_COPY.thanks.unfinishedHeading;

  const body = noSession
    ? BLC_COPY.thanks.unfinishedBody
    : unreachable
      ? BLC_COPY.thanks.unreachableBody
      : data?.status === "completed"
        ? data.accessReady
          ? BLC_COPY.thanks.paidReady
          : BLC_COPY.thanks.paidPending
        : data === undefined || data.status === "open"
          ? BLC_COPY.thanks.pendingBody
          : BLC_COPY.thanks.unfinishedBody;

  const destination = appDestination();

  return (
    <MarketingLayout>
      <section className="founding-hero">
        <div className="c founding-shell">
          <span className="kicker c-accent">{BLC_COPY.thanks.kicker}</span>
          <h1>{heading}</h1>
          <p className="founding-intro" aria-live="polite">
            {body}
          </p>
          {complete ? (
            <>
              <p className="founding-counter">{data.emailMasked}</p>
              <p>
                <a className="btn btn-fill" href={destination.href}>
                  {BLC_COPY.thanks.openApp}
                </a>
              </p>
              <div className="store-btns">
                <AppStoreCta variant="store" />
                <PlayStoreCta variant="store" />
              </div>
            </>
          ) : null}
          <p className="founding-terms">
            <Link to={BLC_PATH}>{BLC_COPY.thanks.backCta}</Link>
          </p>
        </div>
      </section>
    </MarketingLayout>
  );
}

export default BlueLightCardThanks;

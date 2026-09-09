import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";
import { marketingApiBase } from "@/lib/marketingApiBase";
import { trackPurchase } from "@/lib/metaPixel";
import {
  FOUNDING_COPY,
  foundingPlanContentId,
} from "@/marketing/foundingOffer";

interface CheckoutStatus {
  status: "open" | "completed" | "expired" | "refunded";
  tier: string;
  months: number;
  emailMasked: string;
  eventId: string | null;
  amountMinor: number;
  currency: string;
  /** When this checkout's seat hold lapses — the point polling gives up. */
  holdExpiresAt: string;
}

/** A session the API has no record of. Permanent — never worth retrying. */
class UnknownCheckout extends Error {}

async function loadStatus(sessionId: string): Promise<CheckoutStatus> {
  const response = await fetch(
    `${marketingApiBase()}/founding/checkout/${encodeURIComponent(sessionId)}/status`,
  );
  if (response.status === 404) throw new UnknownCheckout();
  if (!response.ok) throw new Error("Status could not be loaded");
  const body = (await response.json()) as { data: CheckoutStatus };
  return body.data;
}

/**
 * Where Stripe returns a buyer (FOUNDING-OFFER BRIEF § 2, 2026-09-05
 * amendment).
 *
 * ─── Why it polls ───
 *
 * Stripe redirects the browser the instant the payment succeeds, but the grant
 * is created by the WEBHOOK, which may land a second or two later. Reading the
 * Session's own status client-side would say "paid" while our side still had
 * nothing — so this polls OUR record instead, and only calls it done when the
 * grant actually exists. Polling stops as soon as the answer is final, so a
 * left-open tab is not a slow leak against the API.
 *
 * ─── Why the event id comes from the server ───
 *
 * The pixel `Purchase` must carry the id the server already used on its own
 * `purchase` event, or Meta counts one sale twice and the ads optimise on a
 * doubled number. It is returned by the status endpoint for exactly that, and
 * fired once per page life.
 */
export function FoundingThanks() {
  const [params] = useSearchParams();
  // Captured ONCE, then removed from the address bar. The id authenticates the
  // status read on its own, and this page loads the Meta pixel — which
  // transmits the full document location. Leaving it in the URL would hand a
  // third party a key to the buyer's tier, amount and masked address.
  const [sessionId] = useState(() => params.get("session_id") ?? "");
  const fired = useRef(false);

  // `useLayoutEffect`, not `useEffect`: `PageViewTracker` is declared above
  // `<Routes>` in App.tsx, so its effect flushes BEFORE this route's. Stripping
  // the id in a layout effect makes the guarantee ordering-based rather than
  // resting on the pixel script happening to read the location after its own
  // network load.
  useLayoutEffect(() => {
    if (!sessionId) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("session_id")) return;
    url.searchParams.delete("session_id");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [sessionId]);

  const status = useQuery({
    queryKey: ["founding", "checkout", sessionId],
    queryFn: () => loadStatus(sessionId),
    enabled: sessionId.length > 0,
    // Only while the answer can still CHANGE. `open` is not terminal on its
    // own — the row only leaves it on a webhook — so polling also stops once
    // the seat hold has lapsed. Without that bound, a bookmarked thanks page
    // for an abandoned checkout issues 30 requests a minute indefinitely.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status !== "open") return false;
      return Date.parse(data.holdExpiresAt) > Date.now() ? 2_000 : false;
    },
    // Retry a flaky network, never a definitive "no such session" — that
    // answer will not change, and retrying it just leaves the buyer watching a
    // spinner for the backoff.
    retry: (failureCount, error) =>
      !(error instanceof UnknownCheckout) && failureCount < 3,
  });

  useSeo({
    title: "Thank you — Persistence",
    description: "Your founding place is being set up.",
    path: "/founding/thanks",
    noindex: true,
  });

  const data = status.data;
  useEffect(() => {
    if (fired.current) return;
    if (data?.status !== "completed" || !data.eventId) return;
    fired.current = true;
    trackPurchase(
      data.eventId,
      data.amountMinor / 100,
      data.currency,
      // The plan bought, from the same `tier`/`months` the server put on its
      // own `purchase` event — so the deduped browser/server pair reports one
      // term, not two.
      foundingPlanContentId(data.tier, data.months),
    );
  }, [data]);

  const heading =
    data?.status === "completed"
      ? FOUNDING_COPY.thanks.paidHeading
      : data === undefined || data.status === "open"
        ? FOUNDING_COPY.thanks.pendingHeading
        : FOUNDING_COPY.thanks.unfinishedHeading;

  const body =
    data?.status === "completed"
      ? FOUNDING_COPY.thanks.paidBody
      : data === undefined || data.status === "open"
        ? FOUNDING_COPY.thanks.pendingBody
        : FOUNDING_COPY.thanks.unfinishedBody;

  // Two different "we cannot tell you" states, deliberately not folded
  // together. No session id at all means the checkout never started. A FAILED
  // read means our own API is unreachable — and this page is only reachable
  // from Stripe's success URL, so telling somebody who has just paid that
  // nothing was charged would be a lie.
  const noSession = sessionId.length === 0;
  const unreachable = !noSession && status.isError;

  return (
    <MarketingLayout>
      <section className="founding-hero">
        <div className="c founding-shell">
          <span className="kicker c-accent">
            {FOUNDING_COPY.kickerNoDeadline}
          </span>
          <h1>
            {noSession
              ? FOUNDING_COPY.thanks.unfinishedHeading
              : unreachable
                ? FOUNDING_COPY.thanks.unreachableHeading
                : heading}
          </h1>
          <p className="founding-intro" aria-live="polite">
            {noSession
              ? FOUNDING_COPY.thanks.unfinishedBody
              : unreachable
                ? FOUNDING_COPY.thanks.unreachableBody
                : body}
          </p>
          {!noSession && !unreachable && data?.status === "completed" ? (
            <p className="founding-counter">{data.emailMasked}</p>
          ) : null}
          <p className="founding-terms">
            <Link to="/founding">{FOUNDING_COPY.thanks.backCta}</Link>
          </p>
        </div>
      </section>
    </MarketingLayout>
  );
}

export default FoundingThanks;

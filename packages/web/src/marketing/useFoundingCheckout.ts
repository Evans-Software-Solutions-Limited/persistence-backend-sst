import { useCallback, useState } from "react";
import { hasConsent } from "@/lib/consent";
import { marketingApiBase } from "@/lib/marketingApiBase";
import {
  getFbc,
  getFbp,
  newEventId,
  trackInitiateCheckout,
} from "@/lib/metaPixel";
import { storedReferralCode } from "./referral";
import type { FoundingMonths, FoundingTier } from "./foundingOffer";

/**
 * Start a founding purchase (FOUNDING-OFFER BRIEF § 2, 2026-09-05 amendment).
 *
 * Mirrors `useLeadSubmit`: a raw `fetch` against the public Core API rather
 * than the Eden `treaty<CoreApi>` client, which sits at TS's instantiation
 * ceiling and has no call-sites.
 *
 * The browser fires `InitiateCheckout` with the SAME `event_id` sent to the
 * server, so the pixel event and the server's `checkout_started` dedupe at
 * Meta instead of counting one intent twice. It fires only on a successful
 * response: a redirect that never happened is not an initiated checkout.
 *
 * Campaign and referral attribution ride along exactly as they do on a store
 * click, so an ad's landing-page purchase and its store click group the same
 * way in the admin attribution tables.
 */
export type CheckoutStatus = "idle" | "submitting" | "error" | "closed";

export interface CheckoutRequest {
  tier: FoundingTier;
  months: FoundingMonths;
  email: string;
  priceMinor: number;
  hp: string;
  turnstileToken?: string;
  campaign?: string;
}

interface CheckoutResponse {
  ok?: boolean;
  url?: string;
  error?: string;
}

export function useFoundingCheckout() {
  const [status, setStatus] = useState<CheckoutStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const start = useCallback(async (request: CheckoutRequest) => {
    setStatus("submitting");
    setMessage(null);
    const eventId = newEventId();
    const fbc = getFbc();
    const fbp = getFbp();
    try {
      const response = await fetch(`${marketingApiBase()}/founding/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: request.tier,
          months: request.months,
          email: request.email.trim(),
          referralCode: storedReferralCode(),
          campaign: request.campaign,
          marketing_consent: hasConsent("advertising"),
          event_id: eventId,
          ...(fbc ? { fbc } : {}),
          ...(fbp ? { fbp } : {}),
          ...(request.turnstileToken
            ? { turnstileToken: request.turnstileToken }
            : {}),
          hp: request.hp,
        }),
      });
      const body = (await response
        .json()
        .catch(() => ({}))) as CheckoutResponse;

      if (response.status === 410) {
        setStatus("closed");
        return false;
      }
      if (!response.ok || !body.ok || !body.url) {
        setStatus("error");
        setMessage(errorMessage(body.error));
        return false;
      }

      trackInitiateCheckout(eventId, request.priceMinor / 100, "GBP");
      // A full navigation, not the router: the destination is Stripe's domain.
      window.location.assign(body.url);
      return true;
    } catch {
      setStatus("error");
      setMessage(errorMessage(undefined));
      return false;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setMessage(null);
  }, []);

  return { status, message, start, reset };
}

/**
 * A refusal the buyer can act on. `pool_full` and `offer_closed` are real
 * outcomes rather than faults, so they read as facts; everything else is our
 * problem and says so rather than blaming the person trying to pay.
 */
function errorMessage(code: string | undefined): string {
  switch (code) {
    case "pool_full":
      return "The last founding place has just gone.";
    case "already_granted":
      return "That address already has a founding place — check your email for the invite.";
    case "too_many_holds":
      // Should be rare: an abandoned checkout is resumed rather than refused.
      // Reachable when the earlier session cannot be recovered from Stripe.
      return "You already have a checkout open. Finish it, or try again in half an hour.";
    case "not_configured":
    case "founding_prices_unavailable":
      return "Payments aren't available right now. Please try again later.";
    case "invalid_email":
      return "That email address doesn't look right.";
    case "challenge_failed":
      return "We couldn't verify that request. Please try again.";
    case "rate_limited":
      return "Too many attempts just now. Please wait a moment and try again.";
    default:
      return "We couldn't start the payment. Please try again in a moment.";
  }
}

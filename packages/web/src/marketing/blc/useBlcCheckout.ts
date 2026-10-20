import { useCallback, useState } from "react";
import { accountSession } from "@/founding/auth";
import { hasConsent } from "@/lib/consent";
import { marketingApiBase } from "@/lib/marketingApiBase";
import {
  getFbc,
  getFbp,
  newEventId,
  trackInitiateCheckout,
} from "@/lib/metaPixel";
import { storedTduid } from "@/lib/tradedoubler";
import {
  BLC_INVALID_CODE_MESSAGE,
  blcPlanContentId,
  type BlcCadence,
  type BlcTier,
} from "./blcOffer";

/**
 * Start a Blue Light Card member purchase (PER-3). Mirrors
 * `useFoundingCheckout`: a raw `fetch` against the public Core API with the
 * verified account's bearer token, the browser's `InitiateCheckout` fired
 * with the SAME `event_id` the server gets (so the pair dedupes at Meta), and
 * a full navigation to Stripe on success.
 *
 * What is different is the attribution: the Tradedoubler click id kept by the
 * landing tag (`storedTduid`, present only with `affiliate` consent) rides
 * along so the server can report the sale to the affiliate network, and the
 * member code goes with it for the server to re-check.
 */
export type BlcCheckoutStatus = "idle" | "submitting" | "error";

export interface BlcCheckoutRequest {
  accountId: string;
  tier: BlcTier;
  cadence: BlcCadence;
  code: string;
  email: string;
  /** The member price, for the browser's `InitiateCheckout` value. */
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

export function useBlcCheckout() {
  const [status, setStatus] = useState<BlcCheckoutStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const start = useCallback(async (request: BlcCheckoutRequest) => {
    setStatus("submitting");
    setMessage(null);
    const eventId = newEventId();
    const fbc = getFbc();
    const fbp = getFbp();
    const tduid = storedTduid();
    try {
      const session = await accountSession(request.accountId);
      const response = await fetch(`${marketingApiBase()}/blc/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          tier: request.tier,
          cadence: request.cadence,
          code: request.code.trim(),
          email: request.email.trim(),
          ...(tduid ? { tduid } : {}),
          ...(request.campaign ? { campaign: request.campaign } : {}),
          marketing_consent: hasConsent("advertising"),
          event_id: eventId,
          ...(fbc ? { fbc } : {}),
          ...(fbp ? { fbp } : {}),
          hp: request.hp,
          ...(request.turnstileToken
            ? { turnstileToken: request.turnstileToken }
            : {}),
        }),
      });
      const body = (await response
        .json()
        .catch(() => ({}))) as CheckoutResponse;

      if (!response.ok || !body.ok || !body.url) {
        setStatus("error");
        setMessage(errorMessage(body.error, response.status));
        return false;
      }

      trackInitiateCheckout(
        eventId,
        request.priceMinor / 100,
        "GBP",
        blcPlanContentId(request.tier, request.cadence),
      );
      // A full navigation, not the router: the destination is Stripe's domain.
      window.location.assign(body.url);
      return true;
    } catch {
      setStatus("error");
      setMessage(errorMessage(undefined, 0));
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
 * A refusal the buyer can act on. The code refusal is deliberately the same
 * neutral line the code check uses — it must not reveal WHY a code failed.
 */
export function errorMessage(
  code: string | undefined,
  httpStatus: number,
): string {
  switch (code) {
    case "invalid_code":
      return BLC_INVALID_CODE_MESSAGE;
    case "active_subscription":
      return "This account already has a paid plan. Sign in with a different account or contact support.";
    case "account_ineligible":
      return "This account can't take this offer. Please contact support.";
    case "unavailable":
      return "Payments aren't available right now. Please try again later.";
    default:
      if (httpStatus === 429)
        return "Too many attempts just now. Please wait a moment and try again.";
      return "We couldn't start the payment. Please try again in a moment.";
  }
}

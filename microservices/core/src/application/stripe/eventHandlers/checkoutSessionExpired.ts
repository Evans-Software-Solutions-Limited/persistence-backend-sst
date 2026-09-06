import type Stripe from "stripe";
import { FoundingCheckoutRepository } from "../../repositories/foundingCheckoutRepository";

/**
 * `checkout.session.expired` — somebody started a founding purchase and walked
 * away. Releases the pool seat their session was holding.
 *
 * Strictly an OPTIMISATION, not a correctness requirement. A hold is already
 * ignored once `hold_expires_at` has passed, so the seat frees itself at the
 * same moment with or without this event. What this adds is a truthful status
 * on the row — `expired` rather than a stale `open` — which is what makes the
 * admin view readable and stops an abandoned checkout looking like one still
 * in flight.
 *
 * Idempotent by construction: `markExpired` only touches `open` rows, so a
 * redelivery does nothing and a session that completed before Stripe expired it
 * (the two can cross) is never walked backwards into a state implying nobody
 * paid.
 */
export async function handleCheckoutSessionExpired(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  await new FoundingCheckoutRepository().markExpired(session.id);
}

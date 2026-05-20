import type Stripe from "stripe";
import { StripeWebhookEventsRepository } from "../repositories/stripeWebhookEventsRepository";
import { getStripe, getStripeWebhookSecret } from "./stripeClient";
import { resolveEventHandler } from "./eventHandlers";

/**
 * POST /stripe/webhook — receives Stripe lifecycle events for subscription
 * + invoice changes.
 *
 * Lives at the Hono parent layer (not Elysia) because signature verification
 * requires the raw request body, and Elysia auto-parses based on
 * Content-Type. The signature header (`stripe-signature`) is an HMAC over
 * the exact bytes Stripe sent; even reformatting the JSON breaks it.
 *
 * Flow:
 *   1. Read raw body + signature header.
 *   2. Construct + verify event via `stripe.webhooks.constructEventAsync`.
 *      Failure → 400 (Stripe treats this as endpoint misconfiguration,
 *      not retry-able).
 *   3. Atomically claim event_id in stripe_webhook_events. On conflict
 *      (already processed), return 200 silently — at-least-once dedup.
 *   4. Dispatch to per-event handler. Handler throw → release the claim
 *      so Stripe's retry can re-run, then propagate as 500.
 *   5. Return 200 on success.
 *
 * Stripe will retry on any non-2xx response; the spacing (1h, 6h, 12h, …)
 * gives the eventual-consistency model time to settle.
 */
export async function handleStripeWebhook(req: Request): Promise<Response> {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      rawBody,
      signature,
      getStripeWebhookSecret(),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[stripe:webhook] signature verification failed: ${message}`);
    return new Response(`Webhook Error: ${message}`, { status: 400 });
  }

  const repo = new StripeWebhookEventsRepository();
  const claimed = await repo.claim(
    event.id,
    event.type,
    event as unknown as Record<string, unknown>,
  );

  if (!claimed) {
    // Duplicate delivery — already processed (or a parallel retry beat us
    // to the insert). Stripe accepts 200 as "I've got this" and stops
    // retrying that delivery.
    console.log(
      `[stripe:webhook] duplicate event ${event.id} (${event.type}) — skipping dispatch`,
    );
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const handler = resolveEventHandler(event.type);
  if (handler === null) {
    // Unhandled event type. Don't 500 — Stripe would retry forever for
    // an event we'll never act on. Log + 200 + keep the row so the
    // idempotency table doubles as a "what events have we seen?" audit
    // log.
    console.log(
      `[stripe:webhook] no handler for ${event.type} (${event.id}) — claimed + skipped`,
    );
    return new Response(
      JSON.stringify({ received: true, handled: false, reason: "no_handler" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    await handler(event);
  } catch (err) {
    // Release the claim so Stripe's retry can re-run dispatch. Best-effort
    // — a release failure here doesn't change the outcome (we're already
    // returning 500), just risks one missed retry if the row stays.
    await repo.release(event.id).catch((releaseErr) => {
      console.error(
        `[stripe:webhook] failed to release claim for ${event.id}: ${
          releaseErr instanceof Error ? releaseErr.message : String(releaseErr)
        }`,
      );
    });
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[stripe:webhook] handler for ${event.type} (${event.id}) threw: ${message}`,
    );
    return new Response(`Handler error: ${message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

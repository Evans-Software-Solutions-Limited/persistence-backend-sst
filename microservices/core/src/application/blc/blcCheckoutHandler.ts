import Elysia, { t } from "elysia";
import { randomUUID } from "node:crypto";
import { getAuthUser } from "@persistence/api-utils/auth/supabaseAuth";
import { getAuthUserIdentity } from "../account/supabaseAdminClient";
import { getStripe } from "../stripe/stripeClient";
import { emitEvent } from "../analytics/emitEvent";
import { verifyTurnstile } from "../leads/turnstile";
import { clientIp, rateLimitExceeded } from "../leads/rateLimit";
import { BlcCheckoutRepository } from "../repositories/blcCheckoutRepository";
import { webOrigin } from "../../shared/webOrigin";
import { maskEmail } from "../../shared/maskEmail";
import { resolveBlcPromotionCode } from "./blcCode";
import { resolveBlcPrice } from "./blcPrices";
import {
  BLC_CHANNEL,
  BLC_CHECKOUT_TERMS,
  BLC_CHECKOUT_TTL_MS,
  blcBillingCycle,
  isBlcCadence,
  isBlcTier,
  type BlcCadence,
  type BlcTier,
} from "./blcOffer";

/**
 * The Blue Light Card web checkout — a Stripe SUBSCRIPTION bought on the
 * marketing site and used in the app.
 *
 * Shape and gates mirror `founding/checkout/foundingCheckoutHandler.ts`:
 * authenticated and account-bound, permissive CORS (the site is another
 * origin), the shared per-IP backstop, a honeypot and Turnstile. Each accepted
 * request creates a Stripe object, so the gates are not decoration.
 *
 * ─── What this route decides, and what Stripe decides ───
 *
 * Stripe owns the PRICE, the DISCOUNT and the CODE. The Session is built from
 * a verified Price id and a verified Promotion Code id; no amount or
 * percentage is carried here. `allow_promotion_codes` is deliberately NOT set
 * on the Session — the code is validated server-side against the BLC coupon
 * and attached through `discounts`, so Stripe's page offers no code box and
 * no other coupon can be entered.
 *
 * This route owns ELIGIBILITY: a verified sign-in, a consumer (non-coach,
 * non-admin, non-deleted) account, and no live paid subscription already on
 * it. The `user_subscriptions` row is created afterwards by the existing
 * `customer.subscription.created` webhook from `subscription_data.metadata`.
 *
 * ─── Subscription mode ───
 *
 * `mode: 'subscription'`, unlike the founding rail. The member price renews at
 * the cadence chosen for as long as the coupon lasts (`duration: forever`), and
 * cancellation is Stripe's ordinary subscription lifecycle, already handled by
 * the `customer.subscription.*` and `invoice.payment_*` handlers.
 */

/**
 * Stripe's "No such checkout.session" (a malformed or unknown id): a
 * `StripeInvalidRequestError` with HTTP 404 and code `resource_missing`.
 * Duck-typed so a mocked client and the real SDK are judged the same way.
 */
function isStripeNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { statusCode, code } = err as { statusCode?: unknown; code?: unknown };
  return statusCode === 404 || code === "resource_missing";
}

const RATE_WINDOW_MS = 60_000;
const CHECKOUT_RATE_LIMIT = 10;
const CODE_CHECK_RATE_LIMIT = 20;
const STATUS_RATE_LIMIT = 120;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};

function withCors(ctx: {
  set: { headers: Record<string, string | number> };
}): void {
  Object.assign(ctx.set.headers, CORS_HEADERS);
}

function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAMPAIGN_SLUG_RE = /^[a-z0-9-]{1,32}$/;

/** Status page vocabulary, derived from the Stripe Session's own `status`. */
export type BlcCheckoutStatus = "open" | "completed" | "expired";

export const blcCheckoutHandler = new Elysia()
  .onError(({ set }) => {
    withCors({ set });
  })
  .post(
    "/blc/code/check",
    async (ctx) => {
      withCors(ctx);
      const ip = clientIp(ctx.headers["x-forwarded-for"]);
      if (
        rateLimitExceeded(
          `blc-code:${ip}`,
          CODE_CHECK_RATE_LIMIT,
          RATE_WINDOW_MS,
        )
      ) {
        ctx.set.status = 429;
        return { ok: false as const, error: "rate_limited" as const };
      }
      // A filled honeypot is answered like a bad code and does nothing: a bot
      // learns nothing and never reaches Stripe.
      if (typeof ctx.body.hp === "string" && ctx.body.hp.length > 0) {
        ctx.set.status = 400;
        return { ok: false as const, error: "invalid_code" as const };
      }
      let promo;
      try {
        promo = await resolveBlcPromotionCode(ctx.body.code);
      } catch (err) {
        console.error(
          `[blc:code] lookup failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        ctx.set.status = 503;
        return { ok: false as const, error: "unavailable" as const };
      }
      if (promo === null) {
        ctx.set.status = 400;
        return { ok: false as const, error: "invalid_code" as const };
      }
      return { ok: true as const };
    },
    {
      body: t.Object({
        code: t.String({ maxLength: 64 }),
        hp: t.Optional(t.String({ maxLength: 200 })),
      }),
      detail: {
        description:
          "Public — is this a Blue Light Card code the checkout will honour?",
        tags: ["BLC"],
      },
    },
  )
  .post(
    "/blc/checkout",
    async (ctx) => {
      withCors(ctx);
      const ip = clientIp(ctx.headers["x-forwarded-for"]);
      if (
        rateLimitExceeded(`leads:${ip}`, CHECKOUT_RATE_LIMIT, RATE_WINDOW_MS)
      ) {
        ctx.set.status = 429;
        return { ok: false as const, error: "rate_limited" as const };
      }

      const user = await getAuthUser(ctx.headers.authorization);
      if (!user) {
        ctx.set.status = 401;
        return { ok: false as const, error: "auth_required" as const };
      }
      let identity;
      try {
        identity = await getAuthUserIdentity(user.sub);
      } catch {
        ctx.set.status = 503;
        return { ok: false as const, error: "unavailable" as const };
      }
      if (!identity.email || !identity.emailConfirmedAt) {
        ctx.set.status = 403;
        return { ok: false as const, error: "email_not_verified" as const };
      }

      // A filled honeypot is answered like a success and does nothing, so a
      // bot cannot tell it was caught. Before Turnstile, so an obvious bot
      // never burns a siteverify call.
      if (typeof ctx.body.hp === "string" && ctx.body.hp.length > 0) {
        return {
          ok: true as const,
          url: `${webOrigin()}/blue-light-card/thanks`,
        };
      }

      // REQUIRED, as on the founding route: every accepted request creates a
      // Stripe Session, and a stage without the secret refuses rather than
      // letting a script mint them for free.
      const outcome = await verifyTurnstile(ctx.body.turnstileToken);
      if (outcome !== "passed") {
        if (outcome === "skipped") {
          console.error(
            "[blc:checkout] refusing — TURNSTILE_SECRET is not configured",
          );
          ctx.set.status = 503;
          return { ok: false as const, error: "not_configured" as const };
        }
        ctx.set.status = 400;
        return { ok: false as const, error: "challenge_failed" as const };
      }

      const email = ctx.body.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        ctx.set.status = 400;
        return { ok: false as const, error: "invalid_email" as const };
      }
      if (!isBlcTier(ctx.body.tier)) {
        ctx.set.status = 400;
        return { ok: false as const, error: "invalid_tier" as const };
      }
      if (!isBlcCadence(ctx.body.cadence)) {
        ctx.set.status = 400;
        return { ok: false as const, error: "invalid_cadence" as const };
      }
      const tier: BlcTier = ctx.body.tier;
      const cadence: BlcCadence = ctx.body.cadence;
      const campaignSlug =
        ctx.body.campaign && CAMPAIGN_SLUG_RE.test(ctx.body.campaign)
          ? ctx.body.campaign
          : null;
      const tduid = ctx.body.tduid?.trim() ?? "";

      // The code, before anything else is looked up: it is the cheapest
      // refusal and the one a buyer can act on.
      let promo;
      try {
        promo = await resolveBlcPromotionCode(ctx.body.code);
      } catch (err) {
        console.error(
          `[blc:checkout] code lookup failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        ctx.set.status = 503;
        return { ok: false as const, error: "unavailable" as const };
      }
      if (promo === null) {
        ctx.set.status = 400;
        return { ok: false as const, error: "invalid_code" as const };
      }

      const refusal = await new BlcCheckoutRepository().eligibility(user.sub);
      if (refusal) {
        ctx.set.status = refusal === "account_ineligible" ? 403 : 409;
        return { ok: false as const, error: refusal };
      }

      // Resolved by lookup key and verified against the amount, currency and
      // interval this offer advertises. A Price that cannot be verified is
      // refused rather than used — a 503, not a 400: the buyer did nothing
      // wrong.
      let priceId;
      try {
        priceId = await resolveBlcPrice(tier, cadence);
      } catch {
        ctx.set.status = 503;
        return { ok: false as const, error: "unavailable" as const };
      }

      const eventId = ctx.body.event_id ?? randomUUID();
      const billingCycle = blcBillingCycle(cadence);
      let session;
      try {
        session = await getStripe().checkout.sessions.create(
          {
            mode: "subscription",
            // Pinned, as every other Stripe call site in this repo is: a
            // delayed method enabled in the dashboard would complete `unpaid`
            // and settle later, a lifecycle nothing here is built for.
            payment_method_types: ["card"],
            // Receipt/contact address only. Access belongs to `user.sub`.
            customer_email: email,
            client_reference_id: user.sub,
            line_items: [{ price: priceId, quantity: 1 }],
            // The ONLY way the member price is applied. `allow_promotion_codes`
            // is deliberately absent so Stripe's page offers no code box.
            discounts: [{ promotion_code: promo.id }],
            success_url: `${webOrigin()}/blue-light-card/thanks?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${webOrigin()}/blue-light-card?cancelled=1`,
            // Computed at SEND time, rounded UP, with a minute of headroom —
            // Stripe's 30-minute minimum is measured from when IT evaluates
            // the request.
            expires_at:
              Math.ceil((Date.now() + BLC_CHECKOUT_TTL_MS) / 1000) + 60,
            consent_collection: { terms_of_service: "required" },
            custom_text: {
              terms_of_service_acceptance: { message: BLC_CHECKOUT_TERMS },
            },
            // What `customer.subscription.created` reads to build the
            // `user_subscriptions` row. `billing_cycle` is the column's
            // vocabulary (`yearly`), not the web's (`annual`).
            subscription_data: {
              metadata: {
                supabase_user_id: user.sub,
                tier_name: tier,
                billing_cycle: billingCycle,
                cadence,
                channel: BLC_CHANNEL,
                voucher: promo.code,
                tduid,
                campaign_slug: campaignSlug ?? "",
              },
            },
            // What `checkout.session.completed` and the status endpoint read.
            metadata: {
              channel: BLC_CHANNEL,
              supabase_user_id: user.sub,
              tier,
              cadence,
              billing_cycle: billingCycle,
              email,
              voucher: promo.code,
              tduid,
              campaign_slug: campaignSlug ?? "",
              event_id: eventId,
              marketing_consent:
                ctx.body.marketing_consent === true ? "true" : "false",
              fbc: ctx.body.fbc ?? "",
              fbp: ctx.body.fbp ?? "",
            },
          },
          { idempotencyKey: `blc-checkout:${user.sub}:${eventId}` },
        );
      } catch (err) {
        console.error(
          `[blc:checkout] Stripe session create failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        ctx.set.status = 503;
        return { ok: false as const, error: "unavailable" as const };
      }

      if (!session.url) {
        console.error("[blc:checkout] Stripe returned a session with no url");
        ctx.set.status = 503;
        return { ok: false as const, error: "unavailable" as const };
      }

      // Intent, not conversion. Deduped with the browser's own
      // `InitiateCheckout` by the shared event id; the drainer consent-gates
      // it. `cadence` rather than a `months` number on purpose: the Meta map
      // turns `tier` × `months` into a FOUNDING plan id, and a BLC annual
      // subscription is not the founding 12-month plan.
      await emitEvent({
        name: "checkout_started",
        source: "web",
        eventId,
        properties: {
          marketing_consent: ctx.body.marketing_consent === true,
          channel: BLC_CHANNEL,
          tier,
          cadence,
          value: (session.amount_total ?? 0) / 100,
          currency: (session.currency ?? "gbp").toUpperCase(),
          ...(ctx.body.fbc ? { fbc: ctx.body.fbc } : {}),
          ...(ctx.body.fbp ? { fbp: ctx.body.fbp } : {}),
          ...(campaignSlug ? { campaign: campaignSlug } : {}),
        },
      });

      return { ok: true as const, url: session.url };
    },
    {
      body: t.Object({
        tier: t.String({ maxLength: 40 }),
        cadence: t.String({ maxLength: 16 }),
        code: t.String({ maxLength: 64 }),
        email: t.String({ maxLength: 320 }),
        tduid: t.Optional(t.String({ maxLength: 128 })),
        campaign: t.Optional(t.String({ maxLength: 32 })),
        marketing_consent: t.Optional(t.Boolean()),
        event_id: t.Optional(t.String({ maxLength: 100 })),
        fbc: t.Optional(t.String({ maxLength: 255 })),
        fbp: t.Optional(t.String({ maxLength: 255 })),
        turnstileToken: t.Optional(t.String({ maxLength: 2048 })),
        hp: t.Optional(t.String({ maxLength: 200 })),
      }),
      detail: {
        description:
          "Authenticated — start a Blue Light Card member subscription for the signed-in account.",
        tags: ["BLC"],
      },
    },
  )
  .get(
    "/blc/checkout/:sessionId/status",
    async (ctx) => {
      withCors(ctx);
      // Never cached: the thanks page polls this until access is ready.
      ctx.set.headers["cache-control"] = "no-store";
      const ip = clientIp(ctx.headers["x-forwarded-for"]);
      if (
        rateLimitExceeded(`blc-status:${ip}`, STATUS_RATE_LIMIT, RATE_WINDOW_MS)
      ) {
        ctx.set.status = 429;
        return { ok: false as const, error: "rate_limited" as const };
      }

      let session;
      try {
        session = await getStripe().checkout.sessions.retrieve(
          ctx.params.sessionId,
          { expand: ["subscription"] },
        );
      } catch (err) {
        // Only Stripe's own "no such Checkout Session" is terminal. Anything
        // else — a rate limit, a 5xx, a dropped connection — is a blip the
        // thanks page retries; answering 404 here would lock a paid buyer
        // into "we can't confirm this" until they refresh.
        if (isStripeNotFound(err)) {
          ctx.set.status = 404;
          return { ok: false as const, error: "not_found" as const };
        }
        ctx.set.status = 503;
        return { ok: false as const, error: "unavailable" as const };
      }
      // Only Sessions THIS rail created. Any other Checkout flow on the
      // account answers 404 rather than leaking its details.
      if (session.metadata?.channel !== BLC_CHANNEL) {
        ctx.set.status = 404;
        return { ok: false as const, error: "not_found" as const };
      }

      const status: BlcCheckoutStatus =
        session.status === "complete"
          ? "completed"
          : session.status === "expired"
            ? "expired"
            : "open";
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : (session.subscription?.id ?? null);
      const accessReady =
        status === "completed" &&
        subscriptionId !== null &&
        (await new BlcCheckoutRepository().isLiveSubscription(subscriptionId));

      return {
        ok: true as const,
        data: {
          status,
          tier: session.metadata?.tier ?? null,
          cadence: session.metadata?.cadence ?? null,
          // Masked, never whole: keyed by an id that lives in a URL.
          emailMasked: maskEmail(
            session.metadata?.email ?? session.customer_email ?? "",
          ),
          amountMinor: session.amount_total ?? 0,
          currency: (session.currency ?? "gbp").toUpperCase(),
          // So the thanks page fires the browser `Purchase` with the SAME id
          // the webhook used, and the two dedupe at Meta.
          eventId: session.metadata?.event_id || `blc-purchase:${session.id}`,
          accessReady,
        },
      };
    },
    {
      params: t.Object({ sessionId: t.String({ maxLength: 200 }) }),
      detail: {
        description: "Public — poll a Blue Light Card checkout's outcome.",
        tags: ["BLC"],
      },
    },
  )
  .options("/blc/code/check", preflight)
  .options("/blc/checkout", preflight);

import Elysia, { t } from "elysia";
import { getStripe } from "../../stripe/stripeClient";
import { emitEvent } from "../../analytics/emitEvent";
import { verifyTurnstile } from "../../leads/turnstile";
import { clientIp, rateLimitExceeded } from "../../leads/rateLimit";
import {
  isValidReferralCode,
  normalizeReferralCode,
} from "../../referrals/referralCode";
import { FoundingCheckoutRepository } from "../../repositories/foundingCheckoutRepository";
import { ReferralRepository } from "../../repositories/referralRepository";
import { resolveFoundingPrice } from "./foundingPrices";
import { FoundingGrantRepository } from "../../repositories/foundingGrantRepository";
import {
  FOUNDING_CHECKOUT_TTL_MS,
  FOUNDING_OFFERS,
  RESERVATION_PREFIX,
  foundingOfferIsOpen,
  isFoundingWebMonths,
  isFoundingWebTier,
  type FoundingWebMonths,
  type FoundingWebTier,
} from "../foundingOffer";

/**
 * The founding web checkout (FOUNDING-OFFER BRIEF § 2, 2026-09-05 amendment).
 *
 * PUBLIC and anonymous, like the lead routes it sits beside, and hardened the
 * same way: permissive CORS (the marketing site is a different origin), the
 * shared `leads` per-IP backstop, a honeypot and Turnstile. It is a heavier
 * abuse target than those, because each accepted request creates a Stripe
 * object AND takes a seat out of a capped pool — so the gates are not optional
 * decoration here.
 *
 * ─── What this route decides, and what Stripe decides ───
 *
 * Stripe owns the PRICE. Nothing here carries an amount; the Session is built
 * from a Price id and the figure charged is whatever that Price says, so a
 * number in this repository can never drift from what a buyer is billed. The
 * amount stored locally is read back off the created Session.
 *
 * This route owns the SEAT. It checks the pool under the same advisory lock
 * `FoundingGrantService` uses, counting live grants plus unexpired holds, and
 * refuses when the pool is full — before creating anything at Stripe.
 *
 * ─── Payment mode, not subscription mode ───
 *
 * `mode: 'payment'`. The offer is fixed-term access that does not renew, so
 * there is no Stripe subscription, no renewal invoice and no cancellation flow
 * to build or explain. The grant's own `expires_at` is the whole lifecycle.
 */

const RATE_WINDOW_MS = 60_000;
const CHECKOUT_RATE_LIMIT = 10;

/**
 * Concurrent unpaid holds one address may have. One: a buyer needs a single
 * checkout at a time, and a hold takes a place out of a capped pool for half
 * an hour for free.
 */
const MAX_OPEN_HOLDS_PER_EMAIL = 1;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function withCors(ctx: {
  set: { headers: Record<string, string | number> };
}): void {
  Object.assign(ctx.set.headers, CORS_HEADERS);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAMPAIGN_SLUG_RE = /^[a-z0-9-]{1,32}$/;

/**
 * Consumer-facing terms text Stripe shows on the Checkout page, transcribed
 * from `LANDING_PAGE.md` § 5.7.
 *
 * This is the sentence the buyer TICKS, so it is the one that forms the
 * contract. It must not drift from `FOUNDING_COPY.termsNote` (§ 5.6) on the
 * page that sent them here — the earlier placeholder said the buyer LOST the
 * 14-day right, while the page said they keep it, which is exactly the
 * contradiction a distance-selling complaint is made of. Change the two
 * together or not at all.
 *
 * ⚠ § 5.7 carries a `[confirm with solicitor]` marker, and § 14.1 lists that
 * confirmation as deploy-blocking. Approved as WORDING, not yet as advice.
 */
export const CHECKOUT_TERMS =
  "I agree to the Persistence terms and ask for my access to start when I sign up. I understand I can cancel within 14 days for a full refund unless I've started using the app.";

export interface CheckoutRefusal {
  status: number;
  body: { ok: false; error: string };
}

/**
 * The web origin the buyer is returned to. Same value the invite email uses.
 *
 * Falls back on an EMPTY value, not just an absent one: `infra/api.ts` sets
 * optional vars to `""` rather than leaving them unset, and `??` would happily
 * pass that through — making `success_url` a relative path, which Stripe
 * rejects when the Session is created. A stage without the variable has to
 * send buyers somewhere real.
 */
function webOrigin(): string {
  return (
    process.env.WEB_ORIGIN?.trim() ||
    "https://persistence.evans-software-solutions.com"
  );
}

/**
 * Mask an address for the thanks page: `sam•••@ex•••••.test`.
 *
 * The status endpoint is public and keyed only by a Session id that travels in
 * a URL, so it must confirm "we have your payment" without handing the address
 * to anyone who gets hold of that link.
 *
 * The kept prefix scales with length rather than being a fixed two characters:
 * `jo@company.com` would otherwise be printed in full, which is no masking at
 * all for exactly the short addresses most likely to be someone's name. The
 * domain is masked too, keeping only its first characters and its public
 * suffix — a rare domain identifies a person nearly as well as their name.
 */
function maskPart(value: string, keep: number): string {
  const head = value.slice(0, Math.min(keep, Math.max(0, value.length - 1)));
  return `${head}${"•".repeat(Math.max(1, value.length - head.length))}`;
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const dot = domain.lastIndexOf(".");
  const [name, suffix] =
    dot > 0 ? [domain.slice(0, dot), domain.slice(dot)] : [domain, ""];
  return `${maskPart(local, Math.min(3, Math.floor(local.length / 2)))}@${maskPart(
    name,
    2,
  )}${suffix}`;
}

/**
 * What to do with an open hold this address already has.
 *
 * Everything here exists to avoid releasing a seat whose Stripe Session can
 * still be paid on. `retrieve` failing is NOT evidence the Session is dead —
 * an API blip and a deleted Session are indistinguishable through a `catch` —
 * so an unanswered lookup refuses rather than releases.
 *
 * A buyer who comes back wanting a DIFFERENT term cannot simply be sent to the
 * old Session: paying there would grant the plan they abandoned. The old
 * Session is expired at Stripe first, which makes releasing the seat safe; if
 * that call fails, the seat stays held.
 */
async function resolveExistingSession(
  hold: {
    id: string;
    stripeSessionId: string;
    tierName: string;
    months: number;
  },
  tier: FoundingWebTier,
  months: FoundingWebMonths,
): Promise<
  { kind: "resume"; url: string } | { kind: "release" } | { kind: "refuse" }
> {
  const stripe = getStripe();
  const existing = await stripe.checkout.sessions
    .retrieve(hold.stripeSessionId)
    .catch(() => null);
  if (existing === null) return { kind: "refuse" };

  if (existing.status === "open") {
    const sameChoice = hold.tierName === tier && hold.months === months;
    if (sameChoice && existing.url)
      return { kind: "resume", url: existing.url };
    // A live Session for a plan they no longer want. Kill it at Stripe before
    // giving the seat back, or it stays payable for the wrong term.
    const expired = await stripe.checkout.sessions
      .expire(hold.stripeSessionId)
      .then(() => true)
      .catch(() => false);
    return expired ? { kind: "release" } : { kind: "refuse" };
  }

  if (existing.status === "complete") {
    // Paid; the webhook has not landed yet. Releasing the seat would orphan
    // that payment, so send them to the page that waits for it.
    return {
      kind: "resume",
      url: `${webOrigin()}/founding/thanks?session_id=${encodeURIComponent(hold.stripeSessionId)}`,
    };
  }

  // `expired` — Stripe is done with it and nobody can pay.
  return { kind: "release" };
}

export const foundingCheckoutHandler = new Elysia()
  .onError(({ set }) => {
    withCors({ set });
  })
  .post(
    "/founding/checkout",
    async (ctx) => {
      withCors(ctx);
      const ip = clientIp(ctx.headers["x-forwarded-for"]);
      if (
        rateLimitExceeded(`leads:${ip}`, CHECKOUT_RATE_LIMIT, RATE_WINDOW_MS)
      ) {
        ctx.set.status = 429;
        return { ok: false as const, error: "rate_limited" as const };
      }

      // A filled honeypot is answered like a success and does nothing, so a bot
      // cannot tell it was caught. Checked before Turnstile so an obvious bot
      // never burns a siteverify call.
      if (typeof ctx.body.hp === "string" && ctx.body.hp.length > 0) {
        return { ok: true as const, url: `${webOrigin()}/founding/thanks` };
      }

      if (!foundingOfferIsOpen()) {
        ctx.set.status = 410;
        return { ok: false as const, error: "offer_closed" as const };
      }

      // REQUIRED here, unlike the lead routes. `verifyTurnstile` returns
      // `skipped` when no secret is configured, which is a sane fail-open for
      // a form that only sends an email — but this route takes a place out of
      // a capped pool for half an hour and costs an attacker nothing. Without
      // a bot gate, a script empties the pool in minutes and re-empties it
      // every thirty, and every real buyer sees "sold out" without a penny
      // changing hands. A stage without the secret refuses instead.
      const outcome = await verifyTurnstile(ctx.body.turnstileToken);
      if (outcome !== "passed") {
        if (outcome === "skipped") {
          console.error(
            "[founding:checkout] refusing — TURNSTILE_SECRET is not configured",
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
      if (!isFoundingWebTier(ctx.body.tier)) {
        ctx.set.status = 400;
        return { ok: false as const, error: "invalid_tier" as const };
      }
      if (!isFoundingWebMonths(ctx.body.months)) {
        ctx.set.status = 400;
        return { ok: false as const, error: "invalid_months" as const };
      }
      const tier: FoundingWebTier = ctx.body.tier;
      const months: FoundingWebMonths = ctx.body.months;

      // Resolved from Stripe by lookup key, and verified against the amount
      // this offer advertises. A key re-pointed at a different Price in the
      // dashboard would otherwise change what the page charges silently, so a
      // Price that cannot be verified is refused rather than used. A 503, not
      // a 400: the buyer did nothing wrong.
      const price = await resolveFoundingPrice(tier, months);
      if (!price.ok) {
        ctx.set.status = 503;
        return {
          ok: false as const,
          error: "founding_prices_unavailable" as const,
        };
      }
      const priceId = price.priceId;

      // A malformed referral code is DROPPED, not rejected: it is attribution
      // only and changes neither price nor entitlement (BRIEF D6), so a typo
      // must not block a sale.
      const canonical = ctx.body.referralCode
        ? normalizeReferralCode(ctx.body.referralCode)
        : null;
      // Existence, not just shape. A well-formed code that no longer exists
      // is refused by the grant service — in the WEBHOOK, after the card has
      // been charged — which contradicts the whole reason a malformed one is
      // dropped: attribution never changes price or entitlement (BRIEF D6), so
      // it must never cost somebody the thing they paid for. A code lookup is
      // not an email lookup, so this leaks nothing about any account.
      const referralCode =
        canonical &&
        isValidReferralCode(canonical) &&
        (await new ReferralRepository().findCodeByCanonical(canonical)) !== null
          ? canonical
          : null;
      const campaignSlug =
        ctx.body.campaign && CAMPAIGN_SLUG_RE.test(ctx.body.campaign)
          ? ctx.body.campaign
          : null;

      const pool = FOUNDING_OFFERS[tier].pool;
      const checkouts = new FoundingCheckoutRepository();
      const grants = new FoundingGrantRepository();

      // Somebody who already holds a place cannot buy a second one: the grant
      // service would refuse the duplicate AFTER the money was taken, leaving
      // Brad to refund by hand. Cheaper to say so before they pay.
      if (await grants.hasLiveOrPendingGrantForEmail(email)) {
        ctx.set.status = 409;
        return { ok: false as const, error: "already_granted" as const };
      }

      const now = new Date();
      // Cancelling on Stripe's page does NOT expire the Session, so the hold
      // survives. Refusing the next attempt would lock a buyer out for half an
      // hour for changing their mind — so an existing checkout is resumed.
      //
      // ⚠ The dangerous move here is RELEASING the seat. A released row is no
      // longer `open`, and `claimForCompletion` only claims open rows — so if
      // the Stripe Session is still payable, a later payment on it finds
      // nothing to claim and the webhook returns quietly: money taken, no
      // grant, no audit row, no alert. The seat is therefore only ever handed
      // back when Stripe has POSITIVELY said the Session is dead.
      const resumable = await checkouts.findOpenHoldForEmail(email, now);
      if (resumable) {
        if (resumable.stripeSessionId.startsWith(RESERVATION_PREFIX)) {
          // A reservation whose Stripe call never completed — the Lambda died
          // between the two. There is no Session to orphan, and leaving it
          // would lock this address out for half an hour over a seat holding
          // nothing.
          await checkouts.releaseReservation(resumable.id);
        } else {
          const outcome = await resolveExistingSession(resumable, tier, months);
          if (outcome.kind === "resume") {
            return { ok: true as const, url: outcome.url };
          }
          if (outcome.kind === "refuse") {
            ctx.set.status = 429;
            return { ok: false as const, error: "too_many_holds" as const };
          }
          await checkouts.releaseReservation(resumable.id);
        }
      }

      const holdExpiresAt = new Date(now.getTime() + FOUNDING_CHECKOUT_TTL_MS);
      // Capacity check AND the hold, in one locked transaction. Checking, then
      // releasing the lock, then making a network round trip and only then
      // recording the hold is check-then-act — two buyers a few hundred
      // milliseconds apart both see the last seat free and both pay for it.
      const reservation = await grants.reserveSeatUnderPoolLock(
        pool,
        async (tx) => {
          const held = await checkouts.countHeldInPool(tx, pool, now);
          const mine = await checkouts.countOpenHoldsForEmail(tx, email, now);
          if (mine >= MAX_OPEN_HOLDS_PER_EMAIL)
            return "too_many_holds" as const;
          return {
            held,
            reserve: () =>
              checkouts.reserveIn(tx, {
                email,
                tierName: tier,
                months,
                referralCode,
                campaignSlug,
                holdExpiresAt,
                eventId: ctx.body.event_id ?? null,
                fbc: ctx.body.fbc ?? null,
                fbp: ctx.body.fbp ?? null,
                marketingConsent: ctx.body.marketing_consent === true,
              }),
          };
        },
      );
      if (reservation === "too_many_holds") {
        ctx.set.status = 429;
        return { ok: false as const, error: "too_many_holds" as const };
      }
      if (reservation === "pool_full") {
        ctx.set.status = 409;
        return { ok: false as const, error: "pool_full" as const };
      }

      let session;
      try {
        session = await getStripe().checkout.sessions.create({
          mode: "payment",
          // Pinned, as the other Stripe call sites in this repo are. Automatic
          // payment methods would let the dashboard enable a delayed method
          // (Bacs, Klarna, bank transfer) whose completion arrives `unpaid`
          // and settles later — a different event, a different lifecycle, and
          // nothing here is built for it.
          payment_method_types: ["card"],
          // Fixed server-side, never editable on Stripe's page: the address is
          // what the grant and its invite are keyed on, and it is the address
          // whose seat we just reserved.
          customer_email: email,
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: `${webOrigin()}/founding/thanks?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${webOrigin()}/founding?cancelled=1`,
          // Computed at SEND time, rounded UP, with a minute of headroom.
          // Stripe's minimum is 30 minutes from when IT evaluates the request,
          // which is later than any timestamp we chose before the pool
          // transaction ran — a stamp fixed earlier and floored is routinely a
          // second or two short and the whole call is rejected.
          expires_at:
            Math.ceil((Date.now() + FOUNDING_CHECKOUT_TTL_MS) / 1000) + 60,
          consent_collection: { terms_of_service: "required" },
          custom_text: {
            terms_of_service_acceptance: {
              message: CHECKOUT_TERMS,
            },
          },
          metadata: {
            tier,
            months: String(months),
            email,
            referral_code: referralCode ?? "",
            campaign_slug: campaignSlug ?? "",
          },
        });
      } catch (err) {
        console.error(
          `[founding:checkout] Stripe session create failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // Hand the seat straight back rather than making the next buyer wait
        // half an hour for a hold nobody is using.
        await checkouts.releaseReservation(reservation.id);
        ctx.set.status = 503;
        return { ok: false as const, error: "unavailable" as const };
      }

      if (!session.url) {
        console.error(
          "[founding:checkout] Stripe returned a session with no url",
        );
        await checkouts.releaseReservation(reservation.id);
        ctx.set.status = 503;
        return { ok: false as const, error: "unavailable" as const };
      }

      // Bind the seat already held to the Session it produced. The amount is
      // read back off the Session, never from anything local — Stripe's Price
      // is the authority on what this costs.
      await checkouts.attachStripeSession(
        reservation.id,
        session.id,
        session.amount_total ?? 0,
        (session.currency ?? "gbp").toUpperCase(),
        // From the SESSION, so the seat is held for at least as long as the
        // page is payable. A hold that lapses first leaves a live Stripe page
        // for a seat somebody else can now be given.
        session.expires_at
          ? new Date(session.expires_at * 1000)
          : holdExpiresAt,
      );

      // Intent, not conversion. Deduped with the browser's own
      // `InitiateCheckout` by the shared event id; the drainer consent-gates it.
      await emitEvent({
        name: "checkout_started",
        source: "web",
        eventId: ctx.body.event_id,
        properties: {
          marketing_consent: ctx.body.marketing_consent === true,
          tier,
          months,
          value: (session.amount_total ?? 0) / 100,
          currency: (session.currency ?? "gbp").toUpperCase(),
          ...(ctx.body.fbc ? { fbc: ctx.body.fbc } : {}),
          ...(ctx.body.fbp ? { fbp: ctx.body.fbp } : {}),
          ...(campaignSlug ? { campaign: campaignSlug } : {}),
          ...(referralCode ? { ref: referralCode } : {}),
        },
      });

      return { ok: true as const, url: session.url };
    },
    {
      body: t.Object({
        tier: t.String({ maxLength: 40 }),
        months: t.Integer({ minimum: 1, maximum: 24 }),
        email: t.String({ maxLength: 320 }),
        referralCode: t.Optional(t.String({ maxLength: 64 })),
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
          "Public — start a founding-access purchase and return the Stripe Checkout url.",
        tags: ["Founding"],
      },
    },
  )
  .get(
    "/founding/checkout/:sessionId/status",
    async (ctx) => {
      withCors(ctx);
      const ip = clientIp(ctx.headers["x-forwarded-for"]);
      if (
        rateLimitExceeded(
          `founding-status:${ip}`,
          // Generous: the thanks page polls while the webhook lands.
          120,
          RATE_WINDOW_MS,
        )
      ) {
        ctx.set.status = 429;
        return { ok: false as const, error: "rate_limited" as const };
      }
      const row = await new FoundingCheckoutRepository().findByStripeSessionId(
        ctx.params.sessionId,
      );
      if (!row) {
        ctx.set.status = 404;
        return { ok: false as const, error: "not_found" as const };
      }
      return {
        ok: true as const,
        data: {
          status: row.status,
          tier: row.tierName,
          months: row.months,
          // Masked, never whole: this endpoint is keyed by an id that lives in
          // a URL, so anyone holding that link must not learn the address.
          emailMasked: maskEmail(row.email),
          // Returned so the thanks page can fire the browser `Purchase` with
          // the SAME id the server used, and the two dedupe at Meta.
          eventId: row.eventId,
          amountMinor: row.amountMinor,
          currency: row.currency,
          // So a client polling an `open` session knows when to give up.
          // `open` is not a terminal state on its own — the row only leaves it
          // on a webhook — so without this a bookmarked thanks page for an
          // abandoned checkout polls forever.
          holdExpiresAt: row.holdExpiresAt.toISOString(),
        },
      };
    },
    {
      params: t.Object({ sessionId: t.String({ maxLength: 200 }) }),
      detail: {
        description: "Public — poll a founding checkout's outcome.",
        tags: ["Founding"],
      },
    },
  )
  .options(
    "/founding/checkout",
    () =>
      new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      }),
  );

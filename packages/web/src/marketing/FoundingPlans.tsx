import { useRef, useState, type FormEvent } from "react";
import { useCampaign } from "./campaign";
import {
  FOUNDING_COPY,
  FOUNDING_PLANS,
  formatPrice,
  type FoundingPlan,
} from "./foundingOffer";
import { Honeypot, TurnstileWidget, type TurnstileHandle } from "./LeadForms";
import { turnstileConfigured } from "@/lib/turnstile";
import { useFoundingCheckout } from "./useFoundingCheckout";
import { isValidEmail } from "./useLeadSubmit";

/**
 * The four founding plans and the one step between choosing and paying
 * (FOUNDING-OFFER BRIEF § 2, 2026-09-05 amendment).
 *
 * ─── Why an email step at all ───
 *
 * Stripe Checkout would happily collect the address itself, but two things
 * need it BEFORE the buyer leaves this site: the pool seat is reserved against
 * it, and the grant and its invite are keyed on it. Letting it be typed (or
 * edited) on Stripe's page would mean holding a seat for one address and
 * granting access to another.
 *
 * ─── Why no consent tick box here ───
 *
 * This form is not a marketing sign-up. Buying does not put anyone on a
 * mailing list, so there is no consent to collect and no box to make someone
 * tick before they can pay. Advertising consent still rides along from the
 * cookie banner, which is what gates the pixel and the CAPI forward.
 *
 * All copy is read from `FOUNDING_COPY` — this file holds none of its own, so
 * dropping in the approved wording is an edit to one data module.
 */

interface PlanCardProps {
  plan: FoundingPlan;
  onChoose: (plan: FoundingPlan) => void;
  disabled: boolean;
}

function PlanCard({ plan, onChoose, disabled }: PlanCardProps) {
  return (
    <article
      className={`founding-plan${plan.featured ? " founding-plan-featured" : ""}`}
    >
      <span>{plan.tierLabel}</span>
      <strong>
        {formatPrice(plan.priceMinor)} · {plan.termLabel}
      </strong>
      <p>{plan.blurb}</p>
      {/* The price is ON the button (LANDING_PAGE.md § 4) so the click is
          informed; the tier is in the accessible name, which the visible
          label alone would not carry between two cards. */}
      <button
        type="button"
        className="btn btn-fill"
        disabled={disabled}
        aria-label={`${plan.tierLabel}, ${plan.termLabel} — ${formatPrice(plan.priceMinor)}`}
        onClick={() => onChoose(plan)}
      >
        {plan.termLabel} — {formatPrice(plan.priceMinor)}
      </button>
    </article>
  );
}

export interface FoundingPlansProps {
  /** True when every place has gone; the buttons go inert and say so. */
  soldOut?: boolean;
}

export function FoundingPlans({ soldOut = false }: FoundingPlansProps) {
  const campaign = useCampaign();
  const checkout = useFoundingCheckout();
  const [chosen, setChosen] = useState<FoundingPlan | null>(null);
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [hp, setHp] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);

  const emailOk = isValidEmail(email);
  const submitting = checkout.status === "submitting";
  // The checkout route REQUIRES a real Turnstile token — a hold there takes a
  // capped pool place, so it cannot fail open the way the lead forms do.
  // Waiting for the token here turns "submitted too early" from a rejected
  // payment into a button that is simply not ready yet.
  const challengeReady = !turnstileConfigured() || turnstileToken !== "";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    // `challengeReady` too, not just the disabled button: a form submits on
    // Enter as well, and the route refuses a tokenless request outright.
    if (!chosen || !emailOk || submitting || !challengeReady) return;
    const ok = await checkout.start({
      tier: chosen.tier,
      months: chosen.months,
      email,
      priceMinor: chosen.priceMinor,
      hp,
      campaign,
      ...(turnstileToken ? { turnstileToken } : {}),
    });
    if (!ok) {
      // The token Turnstile issued was consumed by that attempt — reset the
      // widget so a retry gets a fresh one rather than a duplicate rejection.
      turnstileRef.current?.reset();
      setTurnstileToken("");
    }
  }

  if (soldOut) {
    return (
      <div className="founding-plans-shell">
        <div className="founding-plans" aria-label={FOUNDING_COPY.plansLabel}>
          {FOUNDING_PLANS.map((plan) => (
            <PlanCard
              key={`${plan.tier}-${plan.months}`}
              plan={plan}
              onChoose={() => undefined}
              disabled
            />
          ))}
        </div>
        <p className="founding-note" role="status">
          {FOUNDING_COPY.soldOutNote}
        </p>
      </div>
    );
  }

  if (!chosen) {
    return (
      <div className="founding-plans-shell">
        <div className="founding-plans" aria-label={FOUNDING_COPY.plansLabel}>
          {FOUNDING_PLANS.map((plan) => (
            <PlanCard
              key={`${plan.tier}-${plan.months}`}
              plan={plan}
              onChoose={setChosen}
              disabled={false}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <form
      className="founding-checkout lead-form lead-form-stack"
      aria-label="Founding checkout"
      onSubmit={onSubmit}
      noValidate
    >
      {/* The chosen plan IS the heading (LANDING_PAGE.md § 5.6), so it is
          also what `aria-live` announces when the step opens. */}
      <h2 className="founding-chosen" aria-live="polite">
        {chosen.tierLabel} · {chosen.termLabel} ·{" "}
        {formatPrice(chosen.priceMinor)}
      </h2>
      <p>{FOUNDING_COPY.emailStepBody}</p>
      <div className="lead-row">
        <input
          type="email"
          className="lead-input"
          placeholder="you@email.com"
          aria-label={FOUNDING_COPY.emailLabel}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <button
          type="submit"
          className="btn btn-accent"
          disabled={submitting || !challengeReady}
        >
          {submitting ? FOUNDING_COPY.submittingCta : FOUNDING_COPY.submitCta}
        </button>
      </div>
      <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} />
      <Honeypot value={hp} onChange={setHp} />
      <p className="founding-terms-note">{FOUNDING_COPY.termsNote}</p>
      <button
        type="button"
        className="btn btn-line"
        onClick={() => {
          setChosen(null);
          checkout.reset();
        }}
      >
        {FOUNDING_COPY.backCta}
      </button>
      {touched && emailOk && !challengeReady && (
        <p className="lead-error" role="alert">
          {FOUNDING_COPY.challengeUnavailable}
        </p>
      )}
      {touched && !emailOk && (
        <p className="lead-error" role="alert">
          Enter a valid email address.
        </p>
      )}
      {checkout.status === "closed" && (
        <p className="lead-error" role="alert">
          {FOUNDING_COPY.closedHeading}
        </p>
      )}
      {checkout.status === "error" && checkout.message && (
        <p className="lead-error" role="alert">
          {checkout.message}
        </p>
      )}
    </form>
  );
}

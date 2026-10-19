import { Link } from "react-router";
import {
  IconBrandApple,
  IconBrandGoogle,
  IconCheck,
} from "@tabler/icons-react";
import { Honeypot, TurnstileWidget } from "@/marketing/LeadForms";
import { turnstileConfigured } from "@/lib/turnstile";
import {
  BLC_CADENCES,
  BLC_COPY,
  BLC_MEMBER_SITE,
  BLC_OFFER,
  BLC_TIERS,
  blcTierFeatures,
  blcTierName,
  formatBlcPrice,
  type BlcCadence,
  type BlcTier,
} from "./blcOffer";
import type { BlcOfferView } from "./useBlcOffer";

/**
 * The `/blue-light-card` render (PER-3). Deliberately PLAIN: existing
 * marketing classes, no new CSS, no visual decisions beyond what the step
 * needs — a Claude Design pass restyles this file later and `useBlcOffer`
 * (which owns every decision) stays as it is. Keep it a pure function of its
 * props.
 */
export function BlueLightCardPresenter(view: BlcOfferView) {
  return (
    <section className="ph founding-hero">
      <div className="c founding-shell">
        <span className="kicker c-accent">{BLC_COPY.kicker}</span>
        {view.step === "ungated" ? (
          <Ungated />
        ) : (
          <>
            <h1 className="disp">{BLC_COPY.heading}</h1>
            <p className="founding-intro">{BLC_COPY.intro}</p>
            {view.cancelled && (
              <p className="founding-note" role="status">
                {BLC_COPY.cancelledNote}
              </p>
            )}
            <CodeStep view={view} />
            {view.step === "plans" && <PlanStep view={view} />}
            {(view.step === "account" || view.step === "checkout") && (
              <ChosenPlan view={view} />
            )}
            {view.step === "account" && <AccountStep view={view} />}
            {view.step === "checkout" && <CheckoutStep view={view} />}
            {view.step !== "code" && <Terms />}
          </>
        )}
      </div>
    </section>
  );
}

function Ungated() {
  return (
    <>
      {/* Lockup placeholder — the partner mark lands with the design pass. */}
      <div className="blc-lockup" aria-hidden="true" />
      <h1 className="disp">{BLC_COPY.ungatedHeading}</h1>
      <p className="founding-intro">{BLC_COPY.ungatedBody}</p>
      <p>
        <a
          className="btn btn-accent"
          href={BLC_MEMBER_SITE}
          target="_blank"
          rel="noreferrer noopener"
        >
          {BLC_COPY.ungatedPrimaryCta}
        </a>{" "}
        <Link className="btn btn-line" to="/pricing">
          {BLC_COPY.ungatedSecondaryCta}
        </Link>
      </p>
    </>
  );
}

function CodeStep({ view }: { view: BlcOfferView }) {
  const checking = view.codeStatus === "checking";
  return (
    <form className="lead-form" onSubmit={view.applyCode} noValidate>
      <label htmlFor="blc-code">{BLC_COPY.codeLabel}</label>
      <div className="lead-row">
        <input
          id="blc-code"
          className="lead-input"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={view.code}
          disabled={checking}
          onChange={(e) => view.setCode(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-accent"
          disabled={checking || view.code.trim().length === 0}
        >
          {checking ? BLC_COPY.codeChecking : BLC_COPY.codeApply}
        </button>
      </div>
      {view.codeMessage && (
        <p
          className={
            view.codeStatus === "valid" ? "lead-success" : "lead-error"
          }
          role={view.codeStatus === "valid" ? "status" : "alert"}
        >
          {view.codeMessage}
        </p>
      )}
    </form>
  );
}

function MemberPrice({
  tier,
  cadence,
}: {
  tier: BlcTier;
  cadence: BlcCadence;
}) {
  const price = BLC_OFFER[tier][cadence];
  const unit = cadence === "annual" ? BLC_COPY.perYear : BLC_COPY.perMonth;
  return (
    <>
      <span className="plan-sub">
        {BLC_COPY.publicPriceLabel}{" "}
        <s data-testid={`blc-public-${tier}`}>
          {formatBlcPrice(price.publicMinor)}
          {unit}
        </s>
      </span>
      <span className="catalog-price" data-testid={`blc-member-${tier}`}>
        <span className="amount">{formatBlcPrice(price.memberMinor)}</span>
        <span className="unit">{unit}</span>
      </span>
      <span className="plan-sub">
        {cadence === "annual"
          ? BLC_COPY.billedAnnually
          : BLC_COPY.billedMonthly}
      </span>
    </>
  );
}

function PlanStep({ view }: { view: BlcOfferView }) {
  return (
    <div className="founding-plans-shell">
      <div className="catalog-cadence" aria-label="Billing cadence">
        {BLC_CADENCES.map((value) => (
          <button
            key={value}
            type="button"
            className={view.cadence === value ? "active" : undefined}
            aria-pressed={view.cadence === value}
            onClick={() => view.setCadence(value)}
          >
            {value === "monthly" ? "Monthly" : "Annual"}
          </button>
        ))}
      </div>
      <div className="plans" aria-label={BLC_COPY.plansLabel}>
        {BLC_TIERS.map((tier) => (
          <article
            key={tier}
            className={`plan${tier === "premium_plus" ? " flagship" : ""}`}
            data-testid={`blc-plan-${tier}`}
          >
            <div className="plan-name">{blcTierName(tier)}</div>
            <MemberPrice tier={tier} cadence={view.cadence} />
            <ul className="plan-feats">
              {blcTierFeatures(tier).map((feature) => (
                <li key={feature}>
                  <IconCheck className="chk" size={17} />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={`btn btn-block ${tier === "premium_plus" ? "btn-accent" : "btn-line"}`}
              onClick={() => view.choosePlan(tier)}
            >
              {BLC_COPY.continueCta(blcTierName(tier))}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function ChosenPlan({ view }: { view: BlcOfferView }) {
  const plan = view.selected!;
  const unit = plan.cadence === "annual" ? BLC_COPY.perYear : BLC_COPY.perMonth;
  return (
    <p className="founding-chosen">
      {blcTierName(plan.tier)} · {formatBlcPrice(plan.price.memberMinor)}
      {unit}{" "}
      <button
        type="button"
        className="btn btn-line"
        disabled={view.busy}
        onClick={view.changePlan}
      >
        {BLC_COPY.changePlanCta}
      </button>
    </p>
  );
}

function AccountStep({ view }: { view: BlcOfferView }) {
  return (
    <div className="founding-checkout" aria-busy={view.busy}>
      <h2>{BLC_COPY.accountHeading}</h2>
      <p>{BLC_COPY.accountBody}</p>
      {view.error && (
        <p role="alert" className="lead-error">
          {view.error}
        </p>
      )}
      {view.notice && (
        <p role="status" className="lead-success">
          {view.notice}
        </p>
      )}
      {view.retryableSignIn && (
        <button
          type="button"
          className="btn btn-line"
          disabled={view.busy}
          onClick={() => void view.retrySignIn()}
        >
          Retry sign-in
        </button>
      )}
      <p>
        <button
          type="button"
          className="btn btn-line"
          disabled={view.busy}
          onClick={() => void view.socialSignIn("apple")}
        >
          <IconBrandApple aria-hidden="true" /> Continue with Apple
        </button>{" "}
        <button
          type="button"
          className="btn btn-line"
          disabled={view.busy}
          onClick={() => void view.socialSignIn("google")}
        >
          <IconBrandGoogle aria-hidden="true" /> Continue with Google
        </button>
      </p>
      <form
        className="lead-form lead-form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void view.authenticate();
        }}
      >
        <label htmlFor="blc-account-email">Account email</label>
        <input
          id="blc-account-email"
          className="lead-input"
          type="email"
          required
          autoComplete="email"
          value={view.email}
          disabled={view.busy}
          onChange={(e) => view.setEmail(e.target.value)}
        />
        <label htmlFor="blc-password">
          {view.signup ? "Create a password" : "Password"}
        </label>
        <input
          id="blc-password"
          className="lead-input"
          type="password"
          required
          minLength={view.signup ? 8 : 1}
          autoComplete={view.signup ? "new-password" : "current-password"}
          value={view.password}
          disabled={view.busy}
          onChange={(e) => view.setPassword(e.target.value)}
        />
        {view.signup && (
          <label>
            <input
              type="checkbox"
              required
              checked={view.terms}
              disabled={view.busy}
              onChange={(e) => view.setTerms(e.target.checked)}
            />{" "}
            I agree to the{" "}
            <Link to="/terms" target="_blank" rel="noreferrer">
              Terms
            </Link>{" "}
            and acknowledge the{" "}
            <Link to="/privacy" target="_blank" rel="noreferrer">
              Privacy Policy
            </Link>
            .
          </label>
        )}
        <button type="submit" className="btn btn-accent" disabled={view.busy}>
          {view.busy
            ? "Please wait…"
            : view.signup
              ? "Create account"
              : "Sign in"}
        </button>
      </form>
      {!view.signup && (
        <button
          type="button"
          className="btn btn-line"
          disabled={view.busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(view.email)}
          onClick={() => void view.emailLink()}
        >
          Email me a sign-in link
        </button>
      )}{" "}
      <button
        type="button"
        className="btn btn-ghost"
        disabled={view.busy}
        onClick={() => {
          view.setSignup(!view.signup);
          view.setPassword("");
          view.setTerms(false);
        }}
      >
        {view.signup
          ? "Already have an account? Sign in"
          : "New to Persistence? Create an email account"}
      </button>
    </div>
  );
}

function CheckoutStep({ view }: { view: BlcOfferView }) {
  // Pulled out so the ref is handed to the widget without the rest of the
  // render reading through an object the compiler treats as ref-bearing.
  const { turnstileRef, setTurnstile } = view;
  const account = view.account!;
  const submitting = view.checkout.status === "submitting";
  return (
    <div className="founding-checkout" aria-busy={view.busy}>
      <h2>{BLC_COPY.checkoutHeading}</h2>
      <p>
        Signed in as <strong>{account.email}</strong>{" "}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={view.busy}
          onClick={view.changeAccount}
        >
          {BLC_COPY.logOutCta}
        </button>
      </p>
      {view.error && (
        <p role="alert" className="lead-error">
          {view.error}
        </p>
      )}
      <form className="lead-form lead-form-stack" onSubmit={view.submit}>
        <label htmlFor="blc-receipt-email">{BLC_COPY.receiptEmailLabel}</label>
        <input
          id="blc-receipt-email"
          className="lead-input"
          type="email"
          maxLength={254}
          required
          autoComplete="email"
          value={view.receiptEmail}
          disabled={view.busy}
          onChange={(e) => view.setReceiptEmail(e.target.value)}
        />
        <p className="founding-note">{BLC_COPY.receiptEmailHint}</p>
        <TurnstileWidget ref={turnstileRef} onToken={setTurnstile} />
        <Honeypot value={view.hp} onChange={view.setHp} />
        <button
          type="submit"
          className="btn btn-accent"
          disabled={
            view.busy || (turnstileConfigured() && view.turnstile.length === 0)
          }
        >
          {submitting ? BLC_COPY.submittingCta : BLC_COPY.submitCta}
        </button>
      </form>
      {view.checkout.message && (
        <p role="alert" className="lead-error">
          {view.checkout.message}
        </p>
      )}
    </div>
  );
}

function Terms() {
  return (
    <ul className="founding-terms-note" aria-label="Offer terms">
      {BLC_COPY.terms.map((line) => (
        <li key={line}>{line}</li>
      ))}
      <li>
        Read the <Link to="/terms">terms and conditions</Link>.
      </li>
    </ul>
  );
}

import { Link } from "react-router";
import { AppleIcon } from "@/marketing/icons";
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
import "./blc.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The `/blue-light-card` render (PER-3), from the reviewed Claude Design. A
 * pure function of the view `useBlcOffer` returns — every decision (the gate,
 * the code states, the chosen plan, the sign-in method) is made there; this
 * file only lays it out.
 *
 * Three screens, as the design has them: the offer (hero + code field + the
 * two plan cards, or the ungated hero + proof points), the sign-in
 * interstitial, and — not in the design, so styled with the interstitial's
 * card idiom — the checkout confirmation.
 */
export function BlueLightCardPresenter(view: BlcOfferView) {
  return (
    <div className="blc">
      {view.step === "ungated" && (
        <>
          <Hero gated={false} cancelled={false} />
          <ProofPoints />
        </>
      )}
      {(view.step === "code" || view.step === "plans") && (
        <>
          <Hero gated cancelled={view.cancelled} />
          <section className="blc-offer-sec">
            <div className="c blc-offer">
              <CodeField view={view} />
              <PlanGrid view={view} />
              <Terms />
            </div>
          </section>
        </>
      )}
      {view.step === "account" && <SignIn view={view} />}
      {view.step === "checkout" && <Checkout view={view} />}
    </div>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────── */

function Lockup() {
  return (
    <div className="blc-lockup" aria-label={BLC_COPY.lockupLabel}>
      <span className="blc-lockup-word">Persistence</span>
      <span className="blc-lockup-x" aria-hidden="true">
        ×
      </span>
      {/* Swap this span for the partner mark when the asset arrives. */}
      <span className="blc-lockup-logo">{BLC_COPY.lockupPlaceholder}</span>
    </div>
  );
}

function Hero({ gated, cancelled }: { gated: boolean; cancelled: boolean }) {
  return (
    <section className="blc-hero">
      <div className="c blc-hero-inner">
        <Lockup />
        <span className="blc-chip blc-chip-blc">{BLC_COPY.eyebrow}</span>
        <h1 className="blc-h1 disp">
          {BLC_COPY.headingLead}
          <span className="it">{BLC_COPY.headingEmphasis}</span>
          {BLC_COPY.headingEnd}
        </h1>
        {gated ? (
          <>
            <p className="blc-lead">{BLC_COPY.intro}</p>
            {cancelled && (
              <p className="blc-notice" role="status">
                {BLC_COPY.cancelledNote}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="blc-lead">{BLC_COPY.ungatedBody}</p>
            <div className="blc-ctas">
              <a
                className="btn btn-accent"
                href={BLC_MEMBER_SITE}
                target="_blank"
                rel="noreferrer noopener"
              >
                {BLC_COPY.ungatedPrimaryCta}
                <ArrowOutIcon />
              </a>
              <Link className="btn btn-line" to="/pricing">
                {BLC_COPY.ungatedSecondaryCta}
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ── Ungated proof points ────────────────────────────────────────────── */

const PROOF_ICONS = [
  // offline
  <path
    key="offline"
    d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 5.2-2.7M12 19.5h.01M16.6 10.1a10 10 0 0 1 2.4 2.4M1.4 8.6A15 15 0 0 1 8 5.3M22.6 8.6A15 15 0 0 0 11 5"
  />,
  // barcode
  <path
    key="barcode"
    d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 7v10M12 7v10M16 7v10"
  />,
  // health
  <g key="health">
    <path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 12 5a5.5 5.5 0 0 0-10 3.5c0 2.3 1.5 4 3 5.5l7 7z" />
    <path d="M3.2 12H9l1.5-3 2 6 1.5-3h4.8" />
  </g>,
];

function ProofPoints() {
  return (
    <section className="blc-proof-sec">
      <div className="c">
        <div className="blc-proof">
          {BLC_COPY.proofPoints.map((point, i) => (
            <div className="blc-card blc-proof-card" key={point.heading}>
              <span className="blc-proof-icon">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {PROOF_ICONS[i]}
                </svg>
              </span>
              <h2>{point.heading}</h2>
              <p>{point.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Code field ──────────────────────────────────────────────────────── */

function CodeField({ view }: { view: BlcOfferView }) {
  const checking = view.codeStatus === "checking";
  const invalid = view.codeStatus === "invalid";
  const valid = view.codeStatus === "valid";
  const failed = view.codeStatus === "error";
  return (
    <div className="blc-card blc-code">
      <form className="blc-code-form" onSubmit={view.applyCode} noValidate>
        <label className="blc-field-label" htmlFor="blc-code">
          {BLC_COPY.codeLabel}
        </label>
        <div className="blc-code-row">
          <div className="blc-code-wrap">
            <input
              id="blc-code"
              className="blc-code-input"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={BLC_COPY.codePlaceholder}
              value={view.code}
              disabled={checking}
              aria-invalid={invalid}
              aria-describedby="blc-help blc-status"
              onChange={(e) => view.setCode(e.target.value)}
            />
            {valid && (
              <span className="blc-code-tick" aria-hidden="true">
                <CheckIcon size={14} strokeWidth={2.5} />
              </span>
            )}
            {checking && (
              <span className="blc-spin blc-code-spin" aria-hidden="true" />
            )}
          </div>
          <button
            type="submit"
            className="btn btn-fill blc-code-apply"
            disabled={checking}
          >
            {BLC_COPY.codeApply}
          </button>
        </div>
        <p id="blc-help" className="blc-help">
          {BLC_COPY.codeHelp}
        </p>
        <div
          id="blc-status"
          className="blc-status"
          role="status"
          aria-live="polite"
        >
          {checking && (
            <span className="blc-status-checking">{BLC_COPY.codeChecking}</span>
          )}
          {(invalid || failed) && view.codeMessage && (
            <span className="blc-status-invalid">
              <InfoIcon className="blc-status-icon" />
              <span>{view.codeMessage}</span>
            </span>
          )}
          {valid && view.codeMessage && (
            <span className="blc-status-valid">
              <CheckIcon size={16} strokeWidth={2.25} />
              <span>{view.codeMessage}</span>
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

/* ── Plan cards ──────────────────────────────────────────────────────── */

function PlanGrid({ view }: { view: BlcOfferView }) {
  const locked = view.codeStatus !== "valid";
  return (
    <div className="blc-plans" aria-label={BLC_COPY.plansLabel}>
      {BLC_TIERS.map((tier) => (
        <PlanCard key={tier} tier={tier} locked={locked} view={view} />
      ))}
    </div>
  );
}

function PlanCard({
  tier,
  locked,
  view,
}: {
  tier: BlcTier;
  locked: boolean;
  view: BlcOfferView;
}) {
  const name = blcTierName(tier);
  const highlighted = tier === "premium_plus";
  const price = BLC_OFFER[tier][view.cadence];
  const unit = unitFor(view.cadence);
  const member = formatBlcPrice(price.memberMinor);
  return (
    <article
      className={`blc-card blc-plan${highlighted ? " blc-plan-hl" : ""}${locked ? " blc-plan-locked" : ""}`}
      data-testid={`blc-plan-${tier}`}
    >
      <div className="blc-plan-head">
        <div className="blc-plan-title">
          <h2 className="blc-plan-name">{name}</h2>
          <p className="blc-plan-tag">{BLC_COPY.tagline[tier]}</p>
        </div>
        {highlighted && (
          <span className="blc-chip blc-chip-accent">
            {BLC_COPY.mostPopular}
          </span>
        )}
      </div>

      {/* One cadence for both cards — the control is repeated per card, as
          the design has it, but drives the shared `view.cadence`. */}
      <div
        role="group"
        aria-label={BLC_COPY.billingPeriodLabel}
        className="blc-seg"
      >
        {BLC_CADENCES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={view.cadence === value}
            onClick={() => view.setCadence(value)}
          >
            {value === "monthly" ? "Monthly" : "Annual"}
          </button>
        ))}
      </div>

      <div className="blc-price">
        <p className="blc-price-public">
          <s data-testid={`blc-public-${tier}`}>
            {formatBlcPrice(price.publicMinor)}
            {unit}
          </s>{" "}
          {BLC_COPY.publicPriceLabel}
        </p>
        <div className="blc-price-row">
          <span className="blc-price-member" data-testid={`blc-member-${tier}`}>
            <span className="blc-price-cur">{member.slice(0, 1)}</span>
            <span className="blc-price-amt">{member.slice(1)}</span>
            <span className="blc-price-unit">{unit}</span>
          </span>
          <span className="blc-chip blc-chip-save">{BLC_COPY.saveChip}</span>
        </div>
        <p className="blc-price-note">
          {view.cadence === "annual"
            ? BLC_COPY.billedAnnually
            : BLC_COPY.billedMonthly}
        </p>
      </div>

      <ul className="blc-feats">
        {blcTierFeatures(tier).map((feature) => (
          <li key={feature}>
            <CheckIcon size={18} strokeWidth={2.25} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="blc-plan-foot">
        <button
          type="button"
          className="btn btn-accent btn-block blc-plan-cta"
          disabled={locked}
          onClick={() => view.choosePlan(tier)}
        >
          {BLC_COPY.continueCta(name)}
        </button>
        {locked && <p className="blc-locked-note">{BLC_COPY.lockedNote}</p>}
      </div>
    </article>
  );
}

function Terms() {
  return (
    <div className="blc-terms">
      <p className="blc-terms-h">{BLC_COPY.termsHeading}</p>
      <p>{BLC_COPY.terms.join(" ")}</p>
    </div>
  );
}

/* ── Sign-in interstitial ────────────────────────────────────────────── */

function chosenLine(view: BlcOfferView): string {
  const plan = view.selected!;
  return `${blcTierName(plan.tier)} · ${plan.cadence} · ${formatBlcPrice(plan.price.memberMinor)}${unitFor(plan.cadence)}`;
}

function SignIn({ view }: { view: BlcOfferView }) {
  const emailOk = EMAIL_RE.test(view.email);
  const emailForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (view.passwordMode) void view.authenticate();
    else if (emailOk) void view.emailLink();
  };
  const toggleSignup = () => {
    const next = !view.signup;
    view.setSignup(next);
    view.setPassword("");
    view.setTerms(false);
    if (next) view.setPasswordMode(true);
  };
  return (
    <section className="blc-stage">
      <div className="c blc-stage-inner">
        <div className="blc-card blc-panel" aria-busy={view.busy}>
          <div className="blc-panel-head">
            <h1 className="blc-panel-h">{BLC_COPY.accountHeading}</h1>
            <p className="blc-chosen">{chosenLine(view)}</p>
          </div>

          {view.error && (
            <p role="alert" className="blc-alert">
              {view.error}
            </p>
          )}
          {view.notice && (
            <p role="status" className="blc-success">
              {view.notice}
            </p>
          )}
          {view.retryableSignIn && (
            <button
              type="button"
              className="btn btn-line btn-block"
              disabled={view.busy}
              onClick={() => void view.retrySignIn()}
            >
              Retry sign-in
            </button>
          )}

          <div className="blc-stack">
            <button
              type="button"
              className="btn btn-fill btn-block"
              disabled={view.busy}
              onClick={() => void view.socialSignIn("apple")}
            >
              <AppleIcon /> Continue with Apple
            </button>
            <button
              type="button"
              className="btn btn-line btn-block"
              disabled={view.busy}
              onClick={() => void view.socialSignIn("google")}
            >
              <span className="blc-g" aria-hidden="true">
                G
              </span>
              Continue with Google
            </button>
          </div>

          <div className="blc-or" aria-hidden="true">
            <span />
            or
            <span />
          </div>

          <form className="blc-form" onSubmit={emailForm} noValidate>
            <label className="blc-field-label" htmlFor="blc-account-email">
              {BLC_COPY.emailLabel}
            </label>
            <input
              id="blc-account-email"
              className="blc-field"
              type="email"
              autoComplete="email"
              placeholder={BLC_COPY.emailPlaceholder}
              value={view.email}
              disabled={view.busy}
              onChange={(e) => view.setEmail(e.target.value)}
            />
            {!view.passwordMode && (
              <button
                type="submit"
                className="btn btn-line btn-block"
                disabled={view.busy || !emailOk}
              >
                {BLC_COPY.emailLinkCta}
              </button>
            )}
            <button
              type="button"
              className="blc-disclosure"
              aria-expanded={view.passwordMode}
              aria-controls="blc-password-form"
              disabled={view.busy}
              onClick={() => {
                if (view.passwordMode && view.signup) toggleSignup();
                view.setPasswordMode(!view.passwordMode);
              }}
            >
              {view.passwordMode
                ? BLC_COPY.emailLinkCta
                : BLC_COPY.usePasswordCta}
            </button>
            {view.passwordMode && (
              <div id="blc-password-form" className="blc-form">
                <label className="blc-field-label" htmlFor="blc-password">
                  {view.signup ? "Create a password" : "Password"}
                </label>
                <input
                  id="blc-password"
                  className="blc-field"
                  type="password"
                  required
                  minLength={view.signup ? 8 : 1}
                  autoComplete={
                    view.signup ? "new-password" : "current-password"
                  }
                  value={view.password}
                  disabled={view.busy}
                  onChange={(e) => view.setPassword(e.target.value)}
                />
                {view.signup && (
                  <label className="blc-check">
                    <input
                      type="checkbox"
                      required
                      checked={view.terms}
                      disabled={view.busy}
                      onChange={(e) => view.setTerms(e.target.checked)}
                    />
                    <span>
                      I agree to the{" "}
                      <Link to="/terms" target="_blank" rel="noreferrer">
                        Terms
                      </Link>{" "}
                      and acknowledge the{" "}
                      <Link to="/privacy" target="_blank" rel="noreferrer">
                        Privacy Policy
                      </Link>
                      .
                    </span>
                  </label>
                )}
                <button
                  type="submit"
                  className="btn btn-fill btn-block"
                  disabled={view.busy}
                >
                  {view.busy
                    ? "Please wait…"
                    : view.signup
                      ? "Create account"
                      : "Sign in"}
                </button>
                <button
                  type="button"
                  className="blc-disclosure"
                  disabled={view.busy}
                  onClick={toggleSignup}
                >
                  {view.signup
                    ? "Already have an account? Sign in"
                    : "New to Persistence? Create an email account"}
                </button>
              </div>
            )}
          </form>

          <p className="blc-warn">
            <WarnIcon />
            <span>{BLC_COPY.accountWarning}</span>
          </p>

          <button
            type="button"
            className="btn btn-ghost blc-back"
            disabled={view.busy}
            onClick={view.changePlan}
          >
            <ArrowBackIcon />
            {BLC_COPY.backCta}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ── Checkout confirmation ───────────────────────────────────────────── */

function Checkout({ view }: { view: BlcOfferView }) {
  // Pulled out so the ref is handed to the widget without the rest of the
  // render reading through an object the compiler treats as ref-bearing.
  const { turnstileRef, setTurnstile } = view;
  const account = view.account!;
  const submitting = view.checkout.status === "submitting";
  return (
    <section className="blc-stage">
      <div className="c blc-stage-inner">
        <div className="blc-card blc-panel" aria-busy={view.busy}>
          <div className="blc-panel-head">
            <h1 className="blc-panel-h">{BLC_COPY.checkoutHeading}</h1>
            <p className="blc-chosen">{chosenLine(view)}</p>
          </div>
          <p className="blc-signed-in">
            Signed in as <strong>{account.email}</strong>
            <button
              type="button"
              className="blc-disclosure"
              disabled={view.busy}
              onClick={view.changeAccount}
            >
              {BLC_COPY.logOutCta}
            </button>
          </p>
          {view.error && (
            <p role="alert" className="blc-alert">
              {view.error}
            </p>
          )}
          <form className="blc-form" onSubmit={view.submit}>
            <label className="blc-field-label" htmlFor="blc-receipt-email">
              {BLC_COPY.receiptEmailLabel}
            </label>
            <input
              id="blc-receipt-email"
              className="blc-field"
              type="email"
              maxLength={254}
              required
              autoComplete="email"
              value={view.receiptEmail}
              disabled={view.busy}
              onChange={(e) => view.setReceiptEmail(e.target.value)}
            />
            <p className="blc-help">{BLC_COPY.receiptEmailHint}</p>
            <TurnstileWidget ref={turnstileRef} onToken={setTurnstile} />
            <Honeypot value={view.hp} onChange={view.setHp} />
            <button
              type="submit"
              className="btn btn-accent btn-block"
              disabled={
                view.busy ||
                (turnstileConfigured() && view.turnstile.length === 0)
              }
            >
              {submitting ? BLC_COPY.submittingCta : BLC_COPY.submitCta}
            </button>
          </form>
          {view.checkout.message && (
            <p role="alert" className="blc-alert">
              {view.checkout.message}
            </p>
          )}
          <button
            type="button"
            className="btn btn-ghost blc-back"
            disabled={view.busy}
            onClick={view.changePlan}
          >
            <ArrowBackIcon />
            {BLC_COPY.backCta}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ── Bits ────────────────────────────────────────────────────────────── */

function unitFor(cadence: BlcCadence): string {
  return cadence === "annual" ? BLC_COPY.perYear : BLC_COPY.perMonth;
}

function CheckIcon({
  size,
  strokeWidth,
}: {
  size: number;
  strokeWidth: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg
      className="blc-warn-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
    </svg>
  );
}

function ArrowOutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

function ArrowBackIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7M19 12H5" />
    </svg>
  );
}

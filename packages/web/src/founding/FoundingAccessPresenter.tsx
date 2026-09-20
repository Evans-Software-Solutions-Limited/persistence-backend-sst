import { Button } from "@/components/ui/button";
import { IconBrandApple, IconBrandGoogle } from "@tabler/icons-react";
import type { useFoundingAccess } from "./useFoundingAccess";
import { formatPrice, FOUNDING_COPY } from "@/marketing/foundingOffer";
import { Honeypot, TurnstileWidget } from "@/marketing/LeadForms";
import { turnstileConfigured } from "@/lib/turnstile";
import { membershipTierLabel } from "@/lib/membershipTier";
export function FoundingAccessPresenter({
  plan,
  account,
  busy,
  error,
  notice,
  email,
  password,
  signup,
  terms,
  confirmed,
  purchaseEmail,
  challenge,
  code,
  result,
  hp,
  turnstile,
  turnstileRef,
  checkout,
  destination,
  setEmail,
  setPassword,
  setSignup,
  setTerms,
  setConfirmed,
  setPurchaseEmail,
  setCode,
  setHp,
  setTurnstile,
  setChallenge,
  setError,
  changeAccount,
  submit,
  socialSignIn,
  authenticate,
  emailLink,
}: ReturnType<typeof useFoundingAccess>) {
  return (
    <main
      className={`redemption-page founding-access${account ? " founding-account" : ""}`}
    >
      <header className="redeem-brand">
        <a href="/">
          <img
            src="/web-app-manifest-192x192.png"
            width={48}
            height={48}
            alt=""
          />
          <span>
            Persistence<small>Founding membership</small>
          </span>
        </a>
      </header>
      <div className="redeem-grid">
        {!account && (
          <section className="redeem-intro">
            <span className="redeem-eyebrow">YOUR FOUNDING PLACE</span>
            <h1>
              Your training.
              <br />
              <em>Your account.</em>
            </h1>
            <p>
              {plan
                ? "Secure your founding membership with the account you use in Persistence."
                : "Already purchased? Connect your founding access to your Persistence account securely."}
            </p>
            <p>
              Use the same sign-in method as the app. If you use Apple, choose
              Continue with Apple here. Hide My Email is supported; you do not
              need to know your private relay address.
            </p>
            <p className="redeem-small">
              Do not create another account with your purchase email if you
              already use Apple or Google in the app.
            </p>
          </section>
        )}
        <section
          className="redeem-card"
          aria-label="Founding access"
          aria-busy={busy}
        >
          {account && (
            <header className="founding-account-header">
              <div>
                <h1>Your account</h1>
                <p className="redeem-email">{account.email}</p>
              </div>
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                onClick={changeAccount}
              >
                Log out
              </Button>
            </header>
          )}
          <h2>
            {result
              ? "Your access is ready"
              : !account
                ? "Sign in to Persistence"
                : plan
                  ? "Confirm your membership"
                  : "Activate your purchase"}
          </h2>
          {error && (
            <p role="alert" className="redeem-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="redeem-notice">
              {notice}
            </p>
          )}
          {!account ? (
            <>
              <Button
                className="founding-apple"
                type="button"
                disabled={busy}
                onClick={() => void socialSignIn("apple")}
              >
                <IconBrandApple aria-hidden="true" /> Continue with Apple
              </Button>
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => void socialSignIn("google")}
              >
                <IconBrandGoogle aria-hidden="true" /> Continue with Google
              </Button>
              <p className="redeem-small">
                Or use your existing email and password account.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void authenticate();
                }}
              >
                <label htmlFor="founding-account-email">Account email</label>
                <input
                  id="founding-account-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  disabled={busy}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <label htmlFor="founding-password">
                  {signup ? "Create a password" : "Password"}
                </label>
                <input
                  id="founding-password"
                  type="password"
                  required
                  minLength={signup ? 8 : 1}
                  autoComplete={signup ? "new-password" : "current-password"}
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {signup && (
                  <label className="redeem-check">
                    <input
                      type="checkbox"
                      required
                      checked={terms}
                      disabled={busy}
                      onChange={(e) => setTerms(e.target.checked)}
                    />
                    <span>
                      I agree to the{" "}
                      <a href="/terms" target="_blank" rel="noreferrer">
                        Terms
                      </a>{" "}
                      and acknowledge the{" "}
                      <a href="/privacy" target="_blank" rel="noreferrer">
                        Privacy Policy
                      </a>
                      .
                    </span>
                  </label>
                )}
                <Button
                  className="founding-primary"
                  disabled={busy}
                  type="submit"
                >
                  {busy
                    ? "Please wait…"
                    : signup
                      ? "Create account"
                      : "Sign in"}
                </Button>
              </form>
              {!signup && (
                <Button
                  variant="outline"
                  disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
                  type="button"
                  onClick={() => void emailLink()}
                >
                  Email me a sign-in link
                </Button>
              )}
              <Button
                variant="link"
                type="button"
                disabled={busy}
                onClick={() => {
                  setSignup(!signup);
                  setPassword("");
                  setTerms(false);
                }}
              >
                {signup
                  ? "Already have an account? Sign in"
                  : "New to Persistence? Create an email account"}
              </Button>
            </>
          ) : result ? (
            <>
              <p>
                {membershipTierLabel(result.tierName)} is active until{" "}
                {new Date(result.expiresAt).toLocaleDateString("en-GB")}.
              </p>
              <p>
                Open Persistence and use the same sign-in method. If access has
                not refreshed yet, reopen the app.
              </p>
              <Button asChild>
                <a href={destination.href}>{destination.label}</a>
              </Button>
            </>
          ) : (
            <>
              <p className="redeem-small">
                Use the same account as the app. An Apple private relay address
                is normal. Wrong account? Log out and sign in with the same
                method you use in Persistence.
              </p>
              <form onSubmit={submit}>
                <label className="redeem-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy || !!challenge}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span>
                    This is the Persistence account I want to receive access.
                  </span>
                </label>
                {plan && (
                  <p>
                    <strong>
                      {plan.tierLabel} · {plan.termLabel} ·{" "}
                      {formatPrice(plan.priceMinor)}
                    </strong>
                    <br />
                    One payment. Your term starts once payment is confirmed.
                    Does not renew automatically.
                  </p>
                )}
                {challenge ? (
                  <>
                    <p>
                      Enter the six-digit code sent to{" "}
                      <strong className="redeem-email">{purchaseEmail}</strong>{" "}
                      to verify ownership and check for unclaimed access.
                    </p>
                    <label htmlFor="founding-code">Verification code</label>
                    <input
                      id="founding-code"
                      required
                      pattern="[0-9]{6}"
                      maxLength={6}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      disabled={busy}
                      onChange={(e) => setCode(e.target.value)}
                    />
                    <Button
                      className="founding-primary"
                      type="submit"
                      disabled={busy || !confirmed}
                    >
                      {busy ? "Verifying…" : "Verify and activate access"}
                    </Button>
                    <Button
                      className="redeem-text-link"
                      variant="link"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setChallenge(null);
                        setCode("");
                        setError("");
                      }}
                    >
                      Change purchase email or request a new code
                    </Button>
                  </>
                ) : (
                  <>
                    <label htmlFor="founding-purchase-email">
                      {plan ? "Receipt email" : "Email used for your purchase"}
                    </label>
                    <input
                      id="founding-purchase-email"
                      type="email"
                      maxLength={254}
                      required
                      autoComplete="email"
                      value={purchaseEmail}
                      disabled={busy}
                      onChange={(e) => setPurchaseEmail(e.target.value)}
                    />
                    <p className="redeem-small">
                      {plan
                        ? "Your receipt can go to a different email. Access stays with the account shown above."
                        : "This can differ from your account email. We will send a code to prove this purchase belongs to you."}
                    </p>
                    {plan && (
                      <>
                        <TurnstileWidget
                          ref={turnstileRef}
                          onToken={setTurnstile}
                        />
                        <Honeypot value={hp} onChange={setHp} />
                      </>
                    )}
                    {plan && (
                      <p className="redeem-small">
                        {FOUNDING_COPY.termsNote}{" "}
                        <a href="/terms" target="_blank" rel="noreferrer">
                          Read terms
                        </a>
                      </p>
                    )}
                    <Button
                      className="founding-primary"
                      type="submit"
                      disabled={
                        busy ||
                        !confirmed ||
                        (!!plan && turnstileConfigured() && !turnstile)
                      }
                    >
                      {busy
                        ? "Please wait…"
                        : plan
                          ? "Continue to secure payment"
                          : "Send verification code"}
                    </Button>
                  </>
                )}
              </form>
              {checkout.message && (
                <p role="alert" className="redeem-error">
                  {checkout.message}
                </p>
              )}
              {checkout.status === "closed" && (
                <p role="alert">The founding offer has closed.</p>
              )}
            </>
          )}
          {plan && (
            <a className="redeem-text-link" href="/founding">
              Choose a different plan
            </a>
          )}
          <footer className="redeem-footer">
            Need a hand? <a href="/support">Contact Persistence</a>
          </footer>
        </section>
      </div>
    </main>
  );
}

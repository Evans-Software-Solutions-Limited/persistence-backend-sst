import { membershipTierLabel, isCoachMembership } from "@/lib/membershipTier";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  IconArrowRight,
  IconCheck,
  IconShieldCheck,
  IconTicket,
} from "@tabler/icons-react";
import { useRedemption } from "./useRedemption";
import "./redemption.css";

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="redeem-field">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function AccountForm({
  email,
  busy,
  authenticate,
  emailLink,
}: {
  email: string;
  busy: boolean;
  authenticate: (mode: "signin" | "signup", password: string) => Promise<void>;
  emailLink: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "signup" && !consent) return;
    void authenticate(mode, password).finally(() => setPassword(""));
  }
  return (
    <>
      <div
        className="redeem-segments"
        role="group"
        aria-label="Account options"
      >
        <button
          type="button"
          aria-pressed={mode === "signin"}
          disabled={busy}
          onClick={() => {
            setMode("signin");
            setPassword("");
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          aria-pressed={mode === "signup"}
          disabled={busy}
          onClick={() => {
            setMode("signup");
            setPassword("");
          }}
        >
          Create account
        </button>
      </div>
      <p>
        Membership account: <strong className="redeem-email">{email}</strong>
      </p>
      <form onSubmit={submit}>
        <Field
          id="redeem-password"
          label={mode === "signup" ? "Create a password" : "Password"}
        >
          <Input
            id="redeem-password"
            type="password"
            required
            minLength={mode === "signup" ? 8 : 1}
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {mode === "signup" && (
          <label className="redeem-check">
            <input
              type="checkbox"
              checked={consent}
              required
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
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
        <Button type="submit" disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "signup"
              ? "Create my account"
              : "Sign in"}
          <IconArrowRight size={18} />
        </Button>
      </form>
      {mode === "signin" && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void emailLink()}
        >
          Email me a sign-in link
        </Button>
      )}
      <p className="redeem-small">
        Use the same account you use in the app. A voucher never changes an
        existing account's password.
      </p>
    </>
  );
}

export default function RedeemPage() {
  const flow = useRedemption();
  const [otp, setOtp] = useState("");
  useEffect(() => {
    const previous = document.title;
    document.title = "Redeem your membership · Persistence";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.append(meta);
    const referrer = document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    document.head.append(referrer);
    return () => {
      document.title = previous;
      meta.remove();
      referrer.remove();
    };
  }, []);
  const submit = (action: () => Promise<void>) => (e: FormEvent) => {
    e.preventDefault();
    void action();
  };
  return (
    <main className="redemption-page">
      <header className="redeem-brand">
        <a href="/">
          <img
            src="/web-app-manifest-192x192.png"
            alt=""
            width={48}
            height={48}
          />
          <span>
            Persistence<small>Business memberships</small>
          </span>
        </a>
      </header>
      <div className="redeem-grid">
        <section className="redeem-intro">
          <span className="redeem-eyebrow">YOUR NEXT CHAPTER</span>
          <h1>
            A stronger you.
            <br />
            <em>Supported by your team.</em>
          </h1>
          <p>
            Activate your membership with the code from your employer. Train,
            fuel and track your progress in Persistence.
          </p>
          <div className="redeem-trust">
            <IconShieldCheck size={22} />
            <span>One code. Your account. Securely verified.</span>
          </div>
        </section>
        <section
          className="redeem-card"
          aria-label="Membership redemption"
          aria-busy={flow.busy}
        >
          <IconTicket size={26} className="redeem-accent" aria-hidden="true" />
          <h2>
            {flow.stage === "complete"
              ? "You're ready to train"
              : flow.stage === "account"
                ? "Your membership account"
                : flow.stage === "verify"
                  ? "Verify your eligibility email"
                  : flow.stage === "confirm"
                    ? "Make it yours"
                    : "Redeem your membership"}
          </h2>
          {flow.error && (
            <p role="alert" className="redeem-error">
              {flow.error}
            </p>
          )}
          {flow.notice && (
            <p role="status" className="redeem-notice">
              {flow.notice}
            </p>
          )}
          {flow.stage === "details" && (
            <form onSubmit={submit(flow.details)}>
              <p>
                Enter the code and eligibility email provided by your employer.
              </p>
              <Field id="voucher-code" label="Membership code">
                <Input
                  id="voucher-code"
                  required
                  maxLength={100}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  value={flow.draft.code}
                  disabled={flow.busy}
                  onChange={(e) =>
                    flow.setDraft({ ...flow.draft, code: e.target.value })
                  }
                />
              </Field>
              <Field id="eligibility-email" label="Eligibility email">
                <Input
                  id="eligibility-email"
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={254}
                  value={flow.draft.eligibilityEmail}
                  disabled={flow.busy}
                  onChange={(e) =>
                    flow.setDraft({
                      ...flow.draft,
                      eligibilityEmail: e.target.value,
                    })
                  }
                />
              </Field>
              <p className="redeem-small">
                Usually your work email. We'll verify that you can access it.
              </p>
              <label className="redeem-check">
                <input
                  type="checkbox"
                  checked={flow.draft.differentAccount}
                  disabled={flow.busy}
                  onChange={(e) =>
                    flow.setDraft({
                      ...flow.draft,
                      differentAccount: e.target.checked,
                    })
                  }
                />
                <span>Use a different membership account</span>
              </label>
              {flow.draft.differentAccount && (
                <Field id="membership-email" label="Membership account email">
                  <Input
                    id="membership-email"
                    type="email"
                    required
                    autoComplete="email"
                    maxLength={254}
                    value={flow.draft.accountEmail}
                    disabled={flow.busy}
                    onChange={(e) =>
                      flow.setDraft({
                        ...flow.draft,
                        accountEmail: e.target.value,
                      })
                    }
                  />
                </Field>
              )}
              {flow.account && (
                <p className="redeem-small">
                  Signed in as{" "}
                  <strong className="redeem-email">{flow.account.email}</strong>
                </p>
              )}
              <Button type="submit" disabled={flow.busy}>
                {flow.busy ? "Please wait…" : "Continue"}
                <IconArrowRight size={18} />
              </Button>
            </form>
          )}
          {flow.stage === "account" && (
            <AccountForm
              email={flow.draft.accountEmail}
              busy={flow.busy}
              authenticate={flow.authenticate}
              emailLink={flow.emailLink}
            />
          )}
          {flow.stage === "verify" && flow.challenge && (
            <form onSubmit={submit(() => flow.verify(otp))}>
              <p>
                Enter the verification code sent to{" "}
                <strong className="redeem-email">
                  {flow.challenge.eligibilityEmail}
                </strong>
                . Your membership will belong to{" "}
                <strong className="redeem-email">
                  {flow.challenge.accountEmail}
                </strong>
                .
              </p>
              <Field id="eligibility-otp" label="Email verification code">
                <Input
                  id="eligibility-otp"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  disabled={flow.busy}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={flow.busy}>
                {flow.busy ? "Verifying…" : "Verify email"}
              </Button>
              <p className="redeem-small">
                Code expired or email not received? Choose Edit details below to
                request a fresh code.
              </p>
            </form>
          )}
          {flow.stage === "confirm" && flow.challenge && (
            <>
              <p>
                Your eligibility is verified. Confirm the account that will
                receive access.
              </p>
              <dl className="redeem-summary">
                <dt>Provided by</dt>
                <dd>{flow.challenge.businessName}</dd>
                <dt>Membership</dt>
                <dd>
                  {membershipTierLabel(flow.challenge.tierName)} ·{" "}
                  {flow.challenge.months} months
                </dd>
                <dt>Eligibility email</dt>
                <dd>{flow.challenge.eligibilityEmail}</dd>
                <dt>Membership account</dt>
                <dd>{flow.challenge.accountEmail}</dd>
              </dl>
              <p className="redeem-small">
                Access starts now and does not auto-renew. This code can only be
                used once.
              </p>
              {isCoachMembership(flow.challenge.tierName) ? (
                <p className="redeem-small">
                  This coach membership activates coaching capabilities on the
                  verified membership account shown above. Use that account when
                  signing in to Persistence.
                </p>
              ) : null}
              <Button
                type="button"
                disabled={flow.busy}
                onClick={() => void flow.redeem()}
              >
                {flow.busy ? "Activating…" : "Activate membership"}
                <IconCheck size={18} />
              </Button>
            </>
          )}
          {flow.stage === "complete" && flow.result && (
            <>
              <div className="redeem-success">
                <IconCheck size={28} />
              </div>
              <p>
                {membershipTierLabel(flow.result.tierName)} is active for{" "}
                <strong className="redeem-email">
                  {flow.result.accountEmail}
                </strong>
                .
              </p>
              <p>
                Available until{" "}
                {new Date(flow.result.expiresAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                .
              </p>
              {isCoachMembership(flow.result.tierName) ? (
                <p className="redeem-small">
                  Your coach membership and coaching capabilities are ready.
                  Sign in to the account above in Persistence to continue.
                </p>
              ) : null}
              <Button asChild>
                <a href="persistencemobile://">
                  Open Persistence
                  <IconArrowRight size={18} />
                </a>
              </Button>
              <p className="redeem-small">
                Sign in to that account in the app and finish onboarding if
                you're new. If the plan hasn't refreshed yet, reopen the app and
                check your subscription.
              </p>
              <a href="/" className="redeem-text-link">
                Get the app
              </a>
            </>
          )}
          {flow.stage !== "complete" && flow.stage !== "details" && (
            <button
              type="button"
              className="redeem-text-link"
              disabled={flow.busy}
              onClick={() => {
                setOtp("");
                flow.restart();
              }}
            >
              Edit details
            </button>
          )}
          {flow.account && flow.stage !== "complete" && (
            <button
              type="button"
              className="redeem-text-link"
              disabled={flow.busy}
              onClick={flow.changeAccount}
            >
              Change account
            </button>
          )}
          <footer className="redeem-footer">
            Need a hand? <a href="/support">Contact Persistence</a>
          </footer>
        </section>
      </div>
    </main>
  );
}

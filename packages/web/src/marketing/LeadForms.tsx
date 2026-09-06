import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link } from "react-router";
import { useLeadSubmit, isValidEmail } from "./useLeadSubmit";
import { loadTurnstileScript, turnstileSiteKey } from "../lib/turnstile";

/**
 * Marketing lead-capture forms — an Android notify list (email only; was the
 * iOS launch waitlist until the App Store went live) and a coach enquiry
 * (structured). Both post to the public `/leads/*` Core API endpoints
 * via {@link useLeadSubmit}, carry a required marketing-consent checkbox
 * (UK-GDPR), and a hidden honeypot field the server drops silently when filled.
 *
 * Presentational only beyond the submit hook — styles live under `.mkt
 * .lead-*` in marketing.css so nothing leaks onto /privacy or /terms.
 */

/**
 * Visually-hidden anti-bot field. A real user never sees or fills it.
 *
 * Exported so the founding checkout uses the SAME field name and shape the
 * server already drops on — a second, subtly different honeypot would be a
 * second thing to keep in step.
 */
export function Honeypot({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="lead-hp" aria-hidden="true">
      <label>
        Leave this field blank
        <input
          type="text"
          name="lead_hp"
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}

export function ConsentRow({
  checked,
  onChange,
  id,
  invalid,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
  /** True once the form is submitted without ticking — shows the error state. */
  invalid?: boolean;
}) {
  return (
    <label
      className={`lead-consent${invalid ? " lead-consent-invalid" : ""}`}
      htmlFor={id}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required
        aria-required="true"
      />
      <span>
        <span className="lead-consent-req">Required</span>
        Tick to confirm you're happy for us to email you about the launch and
        product updates. You can unsubscribe at any time — see our{" "}
        <Link to="/privacy">Privacy policy</Link>.
      </span>
    </label>
  );
}

/** Imperative handle exposed by {@link TurnstileWidget} to its parent form. */
export interface TurnstileHandle {
  /**
   * Resets the underlying widget so Turnstile issues a fresh token. Call
   * this after a failed submit — Cloudflare tokens are single-use, so
   * resubmitting the same (already-consumed) token gets a
   * timeout-or-duplicate rejection and the form would otherwise be stuck
   * until a full page reload.
   */
  reset: () => void;
}

/**
 * Cloudflare Turnstile widget — renders only when `VITE_TURNSTILE_SITE_KEY`
 * is set (spec-30 R3.3); otherwise renders nothing and the form submits
 * exactly as it did before Turnstile existed, matching the backend's
 * unconfigured-secret no-op. Loads the challenge script lazily on mount
 * (never eagerly at app startup) and reports the solved token back to the
 * form via `onToken`. Clears the token via `onToken("")` when Turnstile
 * reports the challenge expired (~5 min); the parent form is responsible
 * for clearing its own token state on a failed submit and calling
 * `ref.current.reset()` so a retry gets a fresh challenge.
 */
export const TurnstileWidget = forwardRef<
  TurnstileHandle,
  { onToken: (token: string) => void }
>(function TurnstileWidget({ onToken }, ref) {
  const siteKey = turnstileSiteKey();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  // Keep the latest callback in a ref so the widget doesn't need to be
  // re-created every time a parent re-renders (e.g. on each keystroke).
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    }),
    [],
  );

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(""),
        });
      })
      .catch(() => {
        // Best-effort: a failed script load just means no token is
        // captured. The backend skips verification the same way it does
        // when TURNSTILE_SECRET is unset, so submission still works.
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="lead-turnstile" />;
});

export function WaitlistForm() {
  const { status, submit } = useLeadSubmit("waitlist");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState("");
  const [touched, setTouched] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);

  const emailOk = isValidEmail(email);
  const canSubmit = emailOk && consent && status !== "submitting";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    const ok = await submit({
      email: email.trim(),
      source: "waitlist",
      hp,
      ...(turnstileToken ? { turnstileToken } : {}),
    });
    if (!ok) {
      // The token Turnstile just issued was consumed by that attempt —
      // reset the widget and clear it so a retry gets a fresh one.
      turnstileRef.current?.reset();
      setTurnstileToken("");
    }
  }

  if (status === "success") {
    return (
      <p className="lead-success" role="status">
        You're on the list — we'll email you the moment the Android app lands on
        Google Play.
      </p>
    );
  }

  return (
    <form className="lead-form" onSubmit={onSubmit} noValidate>
      <div className="lead-row">
        <input
          type="email"
          className="lead-input"
          placeholder="you@email.com"
          aria-label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <button
          type="submit"
          className="btn btn-accent"
          disabled={status === "submitting"}
        >
          {status === "submitting" ? "Joining…" : "Notify me at launch"}
        </button>
      </div>
      <ConsentRow
        checked={consent}
        onChange={setConsent}
        id="waitlist-consent"
        invalid={touched && emailOk && !consent}
      />
      <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} />
      <Honeypot value={hp} onChange={setHp} />
      {touched && !emailOk && (
        <p className="lead-error" role="alert">
          Enter a valid email address.
        </p>
      )}
      {touched && emailOk && !consent && (
        <p className="lead-error" role="alert">
          Please tick the box so we can email you.
        </p>
      )}
      {status === "error" && (
        <p className="lead-error" role="alert">
          Something went wrong. Please try again.
        </p>
      )}
    </form>
  );
}

export function CoachEnquiryForm() {
  const { status, submit } = useLeadSubmit("coach");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [clientCount, setClientCount] = useState("");
  const [currentTool, setCurrentTool] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState("");
  const [touched, setTouched] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);

  const emailOk = isValidEmail(email);
  const nameOk = name.trim().length > 0;
  const canSubmit = nameOk && emailOk && consent && status !== "submitting";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    const ok = await submit({
      name: name.trim(),
      email: email.trim(),
      clientCount,
      currentTool: currentTool.trim(),
      message: message.trim(),
      hp,
      ...(turnstileToken ? { turnstileToken } : {}),
    });
    if (!ok) {
      // The token Turnstile just issued was consumed by that attempt —
      // reset the widget and clear it so a retry gets a fresh one.
      turnstileRef.current?.reset();
      setTurnstileToken("");
    }
  }

  if (status === "success") {
    return (
      <p className="lead-success" role="status">
        Thanks — we've got your details and we'll be in touch soon.
      </p>
    );
  }

  return (
    <form className="lead-form lead-form-stack" onSubmit={onSubmit} noValidate>
      <div className="lead-grid">
        <input
          type="text"
          className="lead-input"
          placeholder="Your name"
          aria-label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
        <input
          type="email"
          className="lead-input"
          placeholder="you@email.com"
          aria-label="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <select
          className="lead-input"
          aria-label="How many clients do you train?"
          value={clientCount}
          onChange={(e) => setClientCount(e.target.value)}
        >
          <option value="">How many clients?</option>
          <option value="1-5">1–5</option>
          <option value="6-20">6–20</option>
          <option value="21-50">21–50</option>
          <option value="50+">50+</option>
        </select>
        <input
          type="text"
          className="lead-input"
          placeholder="What do you use now? (optional)"
          aria-label="Current tools"
          value={currentTool}
          onChange={(e) => setCurrentTool(e.target.value)}
        />
      </div>
      <textarea
        className="lead-input lead-textarea"
        placeholder="Anything you'd like us to know? (optional)"
        aria-label="Message"
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <ConsentRow
        checked={consent}
        onChange={setConsent}
        id="coach-consent"
        invalid={touched && nameOk && emailOk && !consent}
      />
      <TurnstileWidget ref={turnstileRef} onToken={setTurnstileToken} />
      <div className="lead-row">
        <button
          type="submit"
          className="btn btn-violet"
          disabled={status === "submitting"}
        >
          {status === "submitting" ? "Sending…" : "Register your interest"}
        </button>
      </div>
      {touched && !(nameOk && emailOk) && (
        <p className="lead-error" role="alert">
          Please add your name and a valid email.
        </p>
      )}
      {touched && nameOk && emailOk && !consent && (
        <p className="lead-error" role="alert">
          Please tick the consent box so we can reply.
        </p>
      )}
      {status === "error" && (
        <p className="lead-error" role="alert">
          Something went wrong. Please try again.
        </p>
      )}
      <Honeypot value={hp} onChange={setHp} />
    </form>
  );
}

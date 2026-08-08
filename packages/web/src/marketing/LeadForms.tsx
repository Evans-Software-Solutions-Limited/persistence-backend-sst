import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useLeadSubmit, isValidEmail } from "./useLeadSubmit";

/**
 * Marketing lead-capture forms — a launch waitlist (email only) and a coach
 * enquiry (structured). Both post to the public `/leads/*` Core API endpoints
 * via {@link useLeadSubmit}, carry a required marketing-consent checkbox
 * (UK-GDPR), and a hidden honeypot field the server drops silently when filled.
 *
 * Presentational only beyond the submit hook — styles live under `.mkt
 * .lead-*` in marketing.css so nothing leaks onto /privacy or /terms.
 */

/** Visually-hidden anti-bot field. A real user never sees or fills it. */
function Honeypot({
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

function ConsentRow({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <label className="lead-consent" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Email me about the launch and product updates. Unsubscribe anytime — see
        our <Link to="/privacy">Privacy policy</Link>.
      </span>
    </label>
  );
}

export function WaitlistForm() {
  const { status, submit } = useLeadSubmit("waitlist");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [hp, setHp] = useState("");
  const [touched, setTouched] = useState(false);

  const emailOk = isValidEmail(email);
  const canSubmit = emailOk && consent && status !== "submitting";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    await submit({ email: email.trim(), source: "waitlist", hp });
  }

  if (status === "success") {
    return (
      <p className="lead-success" role="status">
        You're on the list — we'll email you the moment it goes live.
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
      />
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

  const emailOk = isValidEmail(email);
  const nameOk = name.trim().length > 0;
  const canSubmit = nameOk && emailOk && consent && status !== "submitting";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    await submit({
      name: name.trim(),
      email: email.trim(),
      clientCount,
      currentTool: currentTool.trim(),
      message: message.trim(),
      hp,
    });
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
      <ConsentRow checked={consent} onChange={setConsent} id="coach-consent" />
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

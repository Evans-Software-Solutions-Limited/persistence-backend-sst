import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import "../coach.css";
import {
  parseCallbackHash,
  saveSession,
  sendMagicLink,
} from "../api/coachAuth";
import { Notice } from "../ui/parts";

/**
 * Coach sign-in (PER-124). No canvas board exists for it; it reuses the K
 * layout's type and fields. A magic link to an existing account, like the app.
 */
export interface CoachSignInViewProps {
  email: string;
  onEmail: (v: string) => void;
  onSubmit: () => void;
  state: "idle" | "sending" | "sent";
  error: string | null;
}

export function CoachSignInView({
  email,
  onEmail,
  onSubmit,
  state,
  error,
}: CoachSignInViewProps) {
  return (
    <div className="persistence-coach">
      <main className="center-page">
        <form
          style={{
            width: "100%",
            maxWidth: 400,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <b style={{ fontSize: 17, letterSpacing: -0.4 }}>Persistence</b>
            <span
              className="pl plV"
              style={{ height: 20, fontSize: 10, letterSpacing: 1.2 }}
            >
              COACH
            </span>
          </div>
          <h1 className="h1">Sign in</h1>
          {state === "sent" ? (
            <p className="sub">
              Check your email. We sent a sign-in link to{" "}
              <b style={{ color: "var(--ink)" }}>{email}</b>.
            </p>
          ) : (
            <>
              <div>
                <label className="fl" htmlFor="coach-email">
                  Email
                </label>
                <input
                  id="coach-email"
                  className="fld"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => onEmail(e.target.value)}
                />
                <span className="hint">
                  Use the email of the account you coach from.
                </span>
              </div>
              {error && <Notice tone="error">{error}</Notice>}
              <button
                className="btn v sm"
                type="submit"
                disabled={state === "sending" || !email.trim()}
              >
                {state === "sending" ? "Sending…" : "Email me a sign-in link"}
              </button>
            </>
          )}
        </form>
      </main>
    </div>
  );
}

export function CoachSignIn() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  return (
    <CoachSignInView
      email={email}
      onEmail={setEmail}
      state={state}
      error={error}
      onSubmit={async () => {
        setState("sending");
        setError(null);
        try {
          await sendMagicLink(
            email.trim(),
            `${window.location.origin}/coach/callback`,
          );
          setState("sent");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Sign-in failed");
          setState("idle");
        }
      }}
    />
  );
}

/** `/coach/callback`: the magic link lands here with the tokens in the hash. */
export function CoachCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = useMemo(
    () => parseCallbackHash(location.hash),
    [location.hash],
  );
  const error = parsed.session ? null : parsed.error;
  useEffect(() => {
    if (!parsed.session) return;
    saveSession(parsed.session);
    navigate("/coach/clients", { replace: true });
  }, [parsed, navigate]);
  return (
    <div className="persistence-coach">
      <main
        className="center-page"
        style={{ flexDirection: "column", gap: 12 }}
      >
        {error ? (
          <>
            <Notice tone="error">{error}</Notice>
            <a className="lk" href="/coach/login">
              Back to sign in
            </a>
          </>
        ) : (
          <p className="sub" role="status">
            Signing you in…
          </p>
        )}
      </main>
    </div>
  );
}

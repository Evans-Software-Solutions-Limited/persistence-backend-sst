import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router";

/**
 * Cross-device email-confirmation landing.
 *
 * Supabase is configured to redirect email confirmations (and any other auth
 * link) to `https://persistence.evans-software-solutions.com/auth/callback`,
 * carrying the session in the URL fragment (e.g.
 * `#access_token=…&refresh_token=…&type=signup`, or `#error=…` on failure).
 *
 * The Persistence app registers the `persistencemobile://` scheme, so we hand
 * the whole fragment straight through to `persistencemobile://auth/callback` to
 * complete sign-in inside the app. On a phone this opens the app; on desktop
 * (where the scheme isn't registered) nothing happens and the user simply reads
 * the confirmation and is told to open the app on their phone. The fragment
 * never leaves the device — it's not sent to any server from here.
 */
const DEEP_LINK_BASE = "persistencemobile://auth/callback";

const wrap: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "1rem",
  padding: "2rem",
  textAlign: "center",
  color: "var(--foreground)",
  background: "var(--background)",
};

const card: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "1rem",
  maxWidth: "26rem",
};

const button: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0.75rem 1.5rem",
  borderRadius: "0.75rem",
  fontWeight: 600,
  color: "var(--primary-foreground)",
  background: "var(--primary)",
  textDecoration: "none",
};

/** Read the raw auth fragment (including the leading `#`) from the browser. */
function readHash(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash ?? "";
}

const AuthCallback = () => {
  const [hash] = useState(readHash);

  const { deepLink, error } = useMemo(() => {
    const raw = hash.replace(/^#/, "");
    const params = new URLSearchParams(raw);
    const errorDescription =
      params.get("error_description") ?? params.get("error");
    // `URLSearchParams` already turns `+` into a space, so no extra decode.
    return {
      deepLink: raw ? `${DEEP_LINK_BASE}#${raw}` : DEEP_LINK_BASE,
      error: errorDescription ?? null,
    };
  }, [hash]);

  useEffect(() => {
    document.title = error
      ? "Link didn't work · Persistence"
      : "Email confirmed · Persistence";
  }, [error]);

  // Keep this route out of search indexes — it only ever holds a one-off token.
  useEffect(() => {
    let robots = document.head.querySelector<HTMLMetaElement>(
      'meta[name="robots"]',
    );
    const hadRobots = robots !== null;
    const previous = robots?.getAttribute("content") ?? null;
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
    }
    robots.setAttribute("content", "noindex, nofollow");
    return () => {
      if (!robots) return;
      if (hadRobots && previous !== null)
        robots.setAttribute("content", previous);
      else robots.remove();
    };
  }, []);

  // On a device with the app installed, hand the session straight to the app.
  // Only fire when the link actually carried an auth payload (a bare visit or
  // an error shouldn't bounce anywhere).
  useEffect(() => {
    if (error) return;
    if (hash.replace(/^#/, "") === "") return;
    try {
      window.location.href = deepLink;
    } catch {
      // Scheme not registered (desktop) — the visible button is the fallback.
    }
  }, [deepLink, error, hash]);

  return (
    <main style={wrap}>
      <div style={card}>
        <img
          src="/apple-touch-icon.png"
          alt=""
          aria-hidden="true"
          width={64}
          height={64}
          style={{ borderRadius: "1rem" }}
        />
        {error ? (
          <>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 700 }}>
              Link didn&apos;t work
            </h1>
            <p style={{ color: "var(--muted-foreground)" }}>{error}</p>
            <p style={{ color: "var(--muted-foreground)" }}>
              This link may have expired or already been used. Request a new one
              from the Persistence app on your phone.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 700 }}>
              Email confirmed ✓
            </h1>
            <p style={{ color: "var(--muted-foreground)" }}>
              Open the Persistence app to continue. If it didn&apos;t open
              automatically, tap the button below on your phone.
            </p>
            <a href={deepLink} style={button}>
              Open the app
            </a>
          </>
        )}
        <Link to="/" style={{ color: "var(--primary)", fontWeight: 600 }}>
          ← Back to home
        </Link>
      </div>
    </main>
  );
};

export default AuthCallback;

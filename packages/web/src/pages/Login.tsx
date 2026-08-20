import type { CSSProperties } from "react";
import { Link } from "react-router";
import { appStoreLive } from "@/marketing/config";

// Placeholder login route. Not wired to auth yet — kept as a minimal, tidy
// stub (self-contained styles so it doesn't depend on the removed App.css).
const wrap: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.75rem",
  padding: "2rem",
  textAlign: "center",
  color: "var(--foreground)",
  background: "var(--background)",
};

const Login = () => {
  return (
    <main style={wrap}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700 }}>Sign in</h1>
      {/*
       * Second sentence is config-driven for the same reason as Home and
       * /support: this read "sign in from the app once it's live" for five days
       * after the 15 Aug App Store launch. Nothing links here and it is absent
       * from sitemap.xml, so it is only reachable by a typed URL or an old
       * link — but someone arriving from a stale link is exactly the person who
       * should not be told the app hasn't shipped.
       */}
      <p style={{ color: "var(--muted-foreground)", maxWidth: "28rem" }}>
        Account sign-in isn't available on the web.{" "}
        {appStoreLive()
          ? "Persistence is an iPhone app — sign in from the app."
          : "Persistence is an iPhone app — sign in from the app once it's live."}
      </p>
      <Link to="/" style={{ color: "var(--primary)", fontWeight: 600 }}>
        ← Back to home
      </Link>
    </main>
  );
};

export default Login;

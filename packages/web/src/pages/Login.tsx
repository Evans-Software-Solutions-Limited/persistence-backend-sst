import type { CSSProperties } from "react";
import { Link } from "react-router";

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
      <p style={{ color: "var(--muted-foreground)", maxWidth: "28rem" }}>
        Account sign-in isn't available on the web yet. Persistence is an iPhone
        app — sign in from the app once it's live.
      </p>
      <Link to="/" style={{ color: "var(--primary)", fontWeight: 600 }}>
        ← Back to home
      </Link>
    </main>
  );
};

export default Login;

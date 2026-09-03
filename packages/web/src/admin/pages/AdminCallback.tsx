import { useEffect, useState } from "react";
import { Navigate } from "react-router";
import { parseCallbackHash, saveSession } from "../adminAuth";

/** Lands the magic link: parse `#access_token…`, persist, go to the panel. */
export function AdminCallback() {
  const [result] = useState(() => parseCallbackHash(window.location.hash));

  useEffect(() => {
    if (result.session) {
      saveSession(result.session);
      // Drop the token from the URL bar / history.
      window.history.replaceState(null, "", "/admin/callback");
    }
  }, [result]);

  if (result.session) return <Navigate to="/admin" replace />;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">That link didn't work</h1>
      <p className="max-w-md text-sm text-muted-foreground">{result.error}</p>
      <a
        href="/admin/login"
        className="text-sm font-medium text-primary underline"
      >
        Request a new one
      </a>
    </main>
  );
}

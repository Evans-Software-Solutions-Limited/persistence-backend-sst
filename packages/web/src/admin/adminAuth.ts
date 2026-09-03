/**
 * Admin sign-in for the internal panel (FOUNDING-OFFER FRONTEND_BRIEF § W1).
 *
 * Talks to Supabase GoTrue's REST API directly — a magic link (`/otp`) and the
 * implicit-flow callback (`#access_token=…&refresh_token=…`) that
 * `AuthCallback.tsx` already parses for the mobile flow — so the website
 * takes no new dependency. The session lives in `sessionStorage` (per tab,
 * gone on close): the panel is used from Brad's own devices at events, and a
 * short-lived session is the safer default for a page that can grant
 * subscriptions.
 *
 * The server is the authority on admin-ness (`requireAdmin` reads the JWT's
 * `app_metadata.admin`); this module only decides whether we HAVE a token and
 * exposes the claim for UX (hide the panel from a signed-in non-admin).
 */

export interface AdminSession {
  accessToken: string;
  refreshToken: string | null;
  /** Unix seconds. */
  expiresAt: number;
  email: string | null;
  isAdmin: boolean;
}

const STORAGE_KEY = "persistence.admin.session";
/** Refresh when fewer than this many seconds remain. */
const REFRESH_SKEW_S = 60;

export function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/$/, ""), anonKey };
}

/** Decode the JWT payload without verifying — display/UX only. */
export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function sessionFromTokens(
  accessToken: string,
  refreshToken: string | null,
): AdminSession | null {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  const appMeta =
    typeof payload.app_metadata === "object" && payload.app_metadata !== null
      ? (payload.app_metadata as Record<string, unknown>)
      : {};
  return {
    accessToken,
    refreshToken,
    expiresAt: exp,
    email: typeof payload.email === "string" ? payload.email : null,
    isAdmin: appMeta.admin === true,
  };
}

/** Parse the implicit-flow callback hash. */
export function parseCallbackHash(hash: string): {
  session: AdminSession | null;
  error: string | null;
} {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const error = params.get("error_description") ?? params.get("error");
  if (error) return { session: null, error };
  const access = params.get("access_token");
  if (!access) return { session: null, error: "The link is missing its token" };
  return {
    session: sessionFromTokens(access, params.get("refresh_token")),
    error: null,
  };
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function loadSession(): AdminSession | null {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AdminSession;
    return typeof parsed.accessToken === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: AdminSession | null): void {
  const s = storage();
  if (!s) return;
  if (session) s.setItem(STORAGE_KEY, JSON.stringify(session));
  else s.removeItem(STORAGE_KEY);
}

export function needsRefresh(
  session: AdminSession,
  nowS = Date.now() / 1000,
): boolean {
  return session.expiresAt - nowS < REFRESH_SKEW_S;
}

/** Send the magic link. Resolves on 2xx; throws a readable message otherwise. */
export async function sendMagicLink(
  email: string,
  redirectTo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("Admin sign-in isn't configured for this site");
  const res = await fetchImpl(
    `${cfg.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: "POST",
      headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        create_user: false,
        options: { email_redirect_to: redirectTo },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      res.status === 422 || res.status === 400
        ? "We couldn't send a link to that address"
        : `Sign-in failed (${res.status})`,
    );
  }
}

/** Exchange the refresh token for a new session; null when it can't. */
export async function refreshSession(
  session: AdminSession,
  fetchImpl: typeof fetch = fetch,
): Promise<AdminSession | null> {
  const cfg = supabaseConfig();
  if (!cfg || !session.refreshToken) return null;
  const res = await fetchImpl(
    `${cfg.url}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!body.access_token) return null;
  return sessionFromTokens(
    body.access_token,
    body.refresh_token ?? session.refreshToken,
  );
}

/**
 * The token to use right now: refreshes when close to expiry, persists the
 * result, and returns null when there is no usable session (caller redirects
 * to the login page).
 */
export async function getAccessToken(): Promise<string | null> {
  const current = loadSession();
  if (!current) return null;
  if (!needsRefresh(current)) return current.accessToken;
  const refreshed = await refreshSession(current);
  saveSession(refreshed);
  return refreshed?.accessToken ?? null;
}

export async function signOut(): Promise<void> {
  const cfg = supabaseConfig();
  const current = loadSession();
  saveSession(null);
  if (!cfg || !current) return;
  try {
    await fetch(`${cfg.url}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${current.accessToken}`,
      },
    });
  } catch {
    // Local sign-out already happened; the server session expiring is enough.
  }
}

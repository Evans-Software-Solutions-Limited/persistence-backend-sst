import { decodeJwtPayload, supabaseConfig } from "@/admin/adminAuth";

/**
 * Coach sign-in for the web workspace (PER-124). Same GoTrue magic-link flow
 * as the admin panel (`admin/adminAuth.ts`), with two differences:
 *
 * - the session lives in `localStorage`, because coaches use the workspace
 *   every day and expect to stay signed in (the admin panel is per tab on
 *   purpose; this is not that panel);
 * - `create_user: false`, so only an existing Persistence account gets a link.
 *   Whether that account is a coach is decided by the API (`role`), never here.
 */

export interface CoachSession {
  accessToken: string;
  refreshToken: string | null;
  /** Unix seconds. */
  expiresAt: number;
  email: string | null;
}

export const COACH_SESSION_KEY = "persistence.coach.session";
const REFRESH_SKEW_S = 60;

export function sessionFromTokens(
  accessToken: string,
  refreshToken: string | null,
): CoachSession | null {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt: typeof payload.exp === "number" ? payload.exp : 0,
    email: typeof payload.email === "string" ? payload.email : null,
  };
}

/** Parse the implicit-flow callback hash (`#access_token=…`). */
export function parseCallbackHash(hash: string): {
  session: CoachSession | null;
  error: string | null;
} {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const error = params.get("error_description") ?? params.get("error");
  if (error) return { session: null, error };
  const access = params.get("access_token");
  if (!access) return { session: null, error: "The link is missing its token" };
  const session = sessionFromTokens(access, params.get("refresh_token"));
  return session
    ? { session, error: null }
    : { session: null, error: "The link's token couldn't be read" };
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSession(): CoachSession | null {
  const raw = storage()?.getItem(COACH_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CoachSession;
    return typeof parsed.accessToken === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: CoachSession | null): void {
  const s = storage();
  if (!s) return;
  if (session) s.setItem(COACH_SESSION_KEY, JSON.stringify(session));
  else s.removeItem(COACH_SESSION_KEY);
}

export function needsRefresh(
  session: CoachSession,
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
  if (!cfg) throw new Error("Sign-in isn't set up for this site yet");
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
  session: CoachSession,
  fetchImpl: typeof fetch = fetch,
): Promise<CoachSession | null> {
  const cfg = supabaseConfig();
  if (!cfg || !session.refreshToken) return null;
  try {
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
  } catch {
    return null;
  }
}

/**
 * The token to use now. Refreshes close to expiry and persists the result.
 * Offline, a refresh can't run: the current token is kept (the API call will
 * fail as offline, not as signed out), so the coach isn't signed out by a
 * dropped connection.
 */
export async function getAccessToken(
  fetchImpl: typeof fetch = fetch,
  online: () => boolean = () => navigator.onLine,
): Promise<string | null> {
  const current = loadSession();
  if (!current) return null;
  if (!needsRefresh(current)) return current.accessToken;
  if (!online()) return current.accessToken;
  const refreshed = await refreshSession(current, fetchImpl);
  saveSession(refreshed);
  return refreshed?.accessToken ?? null;
}

export async function signOut(fetchImpl: typeof fetch = fetch): Promise<void> {
  const cfg = supabaseConfig();
  const current = loadSession();
  saveSession(null);
  if (!cfg || !current) return;
  try {
    await fetchImpl(`${cfg.url}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${current.accessToken}`,
      },
    });
  } catch {
    // Signing out locally is what matters.
  }
}

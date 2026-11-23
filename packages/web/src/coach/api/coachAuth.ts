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

/**
 * What a refresh attempt came to. Only `rejected` (GoTrue refused the refresh
 * token, or there isn't one) means the session is over; `unavailable` (no
 * network, a 5xx, a 429 rate limit, an odd reply) keeps it, so a laptop waking
 * before its Wi-Fi or a Supabase outage never signs the coach out.
 */
export type RefreshResult =
  | { kind: "ok"; session: CoachSession }
  | { kind: "rejected" }
  | { kind: "unavailable" };

export const REFRESH_TIMEOUT_MS = 10_000;

function refreshTimeout(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(REFRESH_TIMEOUT_MS)
    : undefined;
}

export async function refreshSession(
  session: CoachSession,
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshResult> {
  const cfg = supabaseConfig();
  if (!session.refreshToken) return { kind: "rejected" };
  if (!cfg) return { kind: "unavailable" };
  try {
    const res = await fetchImpl(
      `${cfg.url}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
        // Bounded: other calls share this request (see refreshStored), so a
        // stalled socket must not hold the whole tab. A timeout is
        // `unavailable` via the catch below.
        signal: refreshTimeout(),
      },
    );
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { kind: "rejected" };
    }
    if (!res.ok) return { kind: "unavailable" };
    const body = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
    };
    const next = body.access_token
      ? sessionFromTokens(
          body.access_token,
          body.refresh_token ?? session.refreshToken,
        )
      : null;
    return next ? { kind: "ok", session: next } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Save a refreshed session only if the stored one is still the session that
 * was refreshed. A refresh that finishes after Sign out (or after another tab
 * swapped the session) must not write a working token back to storage.
 */
export function saveRefreshed(
  refreshedFrom: CoachSession,
  next: CoachSession,
): boolean {
  if (loadSession()?.refreshToken !== refreshedFrom.refreshToken) return false;
  saveSession(next);
  return true;
}

export type StoredRefresh =
  | { kind: "ok"; session: CoachSession }
  | { kind: "signedOut" }
  | { kind: "unavailable" };

const inflight = new Map<string, Promise<RefreshResult>>();

/**
 * Refresh the stored session `current`, the one way every caller refreshes.
 *
 * - Calls in this tab that refresh the same refresh token share ONE request:
 *   focus refetches start several at once, and GoTrue rotates refresh tokens,
 *   so sending the same one twice can be treated as reuse.
 * - Another call or tab may already have swapped the session. Its stored
 *   session is used, never treated as a sign-out. Only an empty store (the
 *   coach signed out meanwhile) answers `signedOut`.
 * - A rejected refresh ends the session, unless the store already holds a
 *   newer session (another tab refreshed first; its token is used).
 */
export async function refreshStored(
  current: CoachSession,
  fetchImpl: typeof fetch = fetch,
): Promise<StoredRefresh> {
  const tokenKey = current.refreshToken ?? "";
  let pending = inflight.get(tokenKey);
  if (!pending) {
    pending = refreshSession(current, fetchImpl).finally(() => {
      inflight.delete(tokenKey);
    });
    inflight.set(tokenKey, pending);
  }
  const result = await pending;
  if (result.kind === "unavailable") return result;
  if (result.kind === "ok" && saveRefreshed(current, result.session)) {
    return result;
  }
  const stored = loadSession();
  if (stored && stored.refreshToken !== current.refreshToken) {
    return { kind: "ok", session: stored };
  }
  if (result.kind === "ok") {
    // Same refresh token still stored means another call already saved this
    // very result; anything else is an empty store.
    return stored ? { kind: "ok", session: stored } : { kind: "signedOut" };
  }
  endSession();
  return { kind: "signedOut" };
}

// ─── Signed-out signal ───────────────────────────────────────────────────────

const signedOutListeners = new Set<() => void>();

/** Run `listener` whenever the session ends under the coach's feet. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => {
    signedOutListeners.delete(listener);
  };
}

/** Clear the session and tell the workspace, which returns to sign-in. */
export function endSession(): void {
  saveSession(null);
  for (const listener of [...signedOutListeners]) listener();
}

/**
 * The token to use now. Refreshes close to expiry and persists the result.
 * The session is only cleared when GoTrue rejects the refresh token. Offline,
 * or when the refresh can't get an answer, the current token is kept: the API
 * call then fails as offline (or as a 401, which signs out), not by wiping
 * storage.
 */
export async function getAccessToken(
  fetchImpl: typeof fetch = fetch,
  online: () => boolean = () => navigator.onLine,
): Promise<string | null> {
  const current = loadSession();
  if (!current) return null;
  if (!needsRefresh(current)) return current.accessToken;
  if (!online()) return current.accessToken;
  const result = await refreshStored(current, fetchImpl);
  if (result.kind === "ok") return result.session.accessToken;
  if (result.kind === "signedOut") return null;
  return current.accessToken;
}

export async function signOut(fetchImpl: typeof fetch = fetch): Promise<void> {
  const cfg = supabaseConfig();
  const current = loadSession();
  saveSession(null);
  if (!cfg || !current) return;
  try {
    // scope=local ends only this browser's session. GoTrue's default (global)
    // revokes every session, including the coach's phone app.
    await fetchImpl(`${cfg.url}/auth/v1/logout?scope=local`, {
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

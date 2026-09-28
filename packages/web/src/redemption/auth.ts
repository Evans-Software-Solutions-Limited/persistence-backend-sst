/** Customer authentication is deliberately separate from the admin session. */
export interface RedemptionSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
export interface MembershipAccount {
  id: string;
  email: string;
}
const KEY = "persistence.redemption.session";
const PENDING_KEY = "persistence.redemption.pending-session";
const PROOF_KEY = "persistence.redemption.apple-proof";
let generation = 0;
class RetryableAuthError extends Error {}
export function isRetryableAuthError(error: unknown): boolean {
  return error instanceof RetryableAuthError;
}

export function authConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

function readSession(key: string): RedemptionSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value &&
      typeof value.accessToken === "string" &&
      typeof value.refreshToken === "string" &&
      Number.isFinite(value.expiresAt)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function loadSession(): RedemptionSession | null {
  return readSession(KEY);
}

function beginAuthentication() {
  generation += 1;
  saveSession(null);
  sessionStorage.removeItem(PENDING_KEY);
  sessionStorage.removeItem(PROOF_KEY);
  return generation;
}

// Keep exchanged tokens separate until the authoritative identity read passes.
// A reload can retry that read without replaying Apple's single-use code.
async function finishPending(session: RedemptionSession, attempt: number) {
  try {
    if (session.expiresAt <= Date.now() / 1000)
      throw new Error("Your sign-in expired. Please sign in again.");
    const account = await verifiedAccount(session);
    if (
      generation !== attempt ||
      readSession(PENDING_KEY)?.accessToken !== session.accessToken
    )
      throw new Error("Your account changed. Please sign in again.");
    saveSession(session);
    sessionStorage.removeItem(PENDING_KEY);
    return account;
  } catch (error) {
    if (!isRetryableAuthError(error) && generation === attempt)
      sessionStorage.removeItem(PENDING_KEY);
    throw error;
  }
}

async function acceptTokens(session: RedemptionSession, attempt: number) {
  if (generation !== attempt)
    throw new Error("Your account changed. Please sign in again.");
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(session));
  return finishPending(session, attempt);
}

export function saveSession(session: RedemptionSession | null) {
  if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
  else sessionStorage.removeItem(KEY);
}

async function authRequest(path: string, body?: unknown, accessToken?: string) {
  const cfg = authConfig();
  if (!cfg)
    throw new Error(
      "Online redemption is not configured. Please contact Persistence support.",
    );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const canRetry =
    path === "/user" || path === "/token?grant_type=refresh_token";
  const transientError = (message: string) =>
    canRetry ? new RetryableAuthError(message) : new Error(message);
  try {
    let response: Response;
    let data: Record<string, unknown>;
    try {
      response = await fetch(`${cfg.url}/auth/v1${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          apikey: cfg.key,
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      data = await response.json().catch((error: unknown) => {
        if (response.ok) throw error;
        return {};
      });
    } catch {
      throw transientError(
        "We couldn't reach sign-in services. Check your connection and try again.",
      );
    }
    if (!response.ok) {
      if (response.status === 429)
        throw transientError(
          "Too many attempts. Please wait before trying again.",
        );
      if (response.status >= 500)
        throw transientError(
          "Sign-in services are temporarily unavailable. Please try again.",
        );
      // Only allowlisted error codes become user-facing copy; never show payload text.
      const code = data.code ?? data.error_code;
      if (code === "weak_password")
        throw new Error(
          "Choose a stronger password: use at least 8 characters and avoid common or previously exposed passwords. A longer, unique passphrase works well.",
        );
      if (code === "invalid_credentials")
        throw new Error(
          "The email or password is incorrect. Try again or request an email sign-in link.",
        );
      if (code === "email_not_confirmed")
        throw new Error(
          "Confirm your membership email using the link we sent before signing in.",
        );
      if (code === "otp_expired")
        throw new Error(
          "This sign-in link has expired. Request a new email sign-in link.",
        );
      throw new Error(
        "We couldn't complete sign-in. Check your details or request an email sign-in link.",
      );
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function tokenSession(data: Record<string, unknown>): RedemptionSession {
  if (
    typeof data.access_token !== "string" ||
    typeof data.refresh_token !== "string"
  )
    throw new Error(
      "The sign-in response was incomplete. Please sign in again.",
    );
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:
      typeof data.expires_at === "number"
        ? data.expires_at
        : Date.now() / 1000 +
          (typeof data.expires_in === "number" ? data.expires_in : 3600),
  };
}

async function verifiedAccount(
  session: RedemptionSession,
): Promise<MembershipAccount> {
  const user = await authRequest("/user", undefined, session.accessToken);
  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    !user.email_confirmed_at
  )
    throw new Error("Verify your membership account email before redeeming.");
  return { id: user.id, email: user.email };
}

let refresh: Promise<RedemptionSession> | null = null;
export async function activeSession(): Promise<RedemptionSession> {
  const current = loadSession();
  if (!current) throw new Error("Please sign in to your membership account.");
  if (current.expiresAt > Date.now() / 1000 + 60) return current;
  if (!refresh) {
    refresh = (async () => {
      const next = tokenSession(
        await authRequest("/token?grant_type=refresh_token", {
          refresh_token: current.refreshToken,
        }),
      );
      if (loadSession()?.accessToken !== current.accessToken)
        throw new Error(
          "Your account changed. Please continue with the current account.",
        );
      saveSession(next);
      return next;
    })().finally(() => {
      refresh = null;
    });
  }
  return refresh;
}

export async function currentAccount(): Promise<MembershipAccount | null> {
  const pending = readSession(PENDING_KEY);
  if (pending) return finishPending(pending, generation);
  if (!loadSession()) return null;
  const attempt = generation;
  const session = await activeSession();
  const account = await verifiedAccount(session);
  if (
    attempt !== generation ||
    loadSession()?.accessToken !== session.accessToken
  )
    throw new Error("Your account changed. Please sign in again.");
  return account;
}

export async function signIn(
  email: string,
  password: string,
): Promise<MembershipAccount> {
  const attempt = beginAuthentication();
  const session = tokenSession(
    await authRequest("/token?grant_type=password", { email, password }),
  );
  return acceptTokens(session, attempt);
}

export function callbackUrl() {
  return `${window.location.origin}/redeem/callback`;
}

export async function signUp(
  email: string,
  password: string,
): Promise<MembershipAccount | null> {
  const attempt = beginAuthentication();
  const data = await authRequest(
    `/signup?redirect_to=${encodeURIComponent(callbackUrl())}`,
    { email, password },
  );
  if (!data.access_token) return null;
  const session = tokenSession(data);
  return acceptTokens(session, attempt);
}

export async function sendSignInLink(email: string): Promise<void> {
  await authRequest(`/otp?redirect_to=${encodeURIComponent(callbackUrl())}`, {
    email,
    create_user: false,
  });
}

export async function completeCallback(
  hash: string,
): Promise<MembershipAccount> {
  const attempt = beginAuthentication();
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.has("error"))
    throw new Error(
      "This sign-in link has expired or could not be verified. Request a new one.",
    );
  const access = params.get("access_token"),
    refreshToken = params.get("refresh_token");
  if (!access || !refreshToken)
    throw new Error(
      "This link is missing its sign-in details. Please sign in again.",
    );
  const expiry = Number(params.get("expires_in") ?? "3600");
  const session = tokenSession({
    access_token: access,
    refresh_token: refreshToken,
    expires_in: Number.isFinite(expiry) && expiry > 0 ? expiry : 3600,
  });
  return acceptTokens(session, attempt);
}

/** A tab-local proof keeps Apple returns isolated from founding and admin auth. */
export async function appleOAuthUrl(): Promise<string> {
  const cfg = authConfig();
  if (!cfg)
    throw new Error(
      "Apple sign-in is unavailable. Please contact Persistence support.",
    );
  const attempt = beginAuthentication();
  const randomToken = () =>
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  const verifier = randomToken();
  const state = randomToken();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  if (attempt !== generation)
    throw new Error("Your account changed. Please sign in again.");
  sessionStorage.setItem(
    PROOF_KEY,
    JSON.stringify({ verifier, state, createdAt: Date.now() }),
  );
  const url = new URL(`${cfg.url}/auth/v1/authorize`);
  url.search = new URLSearchParams({
    provider: "apple",
    redirect_to: `${callbackUrl()}?flow=${encodeURIComponent(state)}`,
    code_challenge: challenge,
    code_challenge_method: "s256",
  }).toString();
  return url.toString();
}

export async function completeAppleCallback(
  search: string,
  hash: string,
): Promise<MembershipAccount> {
  const params = new URLSearchParams(search);
  let proof;
  try {
    proof = JSON.parse(sessionStorage.getItem(PROOF_KEY) ?? "null");
  } catch {
    /* Corrupt proof fails closed. */
  }
  // Consume before asynchronous work so single-use codes cannot be replayed.
  sessionStorage.removeItem(PROOF_KEY);
  const attempt = beginAuthentication();
  if (
    params.has("error") ||
    new URLSearchParams(hash.replace(/^#/, "")).has("error")
  )
    throw new Error(
      "Apple sign-in was cancelled or could not be completed. Please try again.",
    );
  if (
    !proof ||
    typeof proof.verifier !== "string" ||
    proof.verifier.length < 43 ||
    typeof proof.state !== "string" ||
    !proof.state ||
    params.get("flow") !== proof.state ||
    !Number.isFinite(proof.createdAt) ||
    proof.createdAt > Date.now() ||
    Date.now() - proof.createdAt > 60 * 60 * 1000 ||
    !params.get("code")
  )
    throw new Error(
      "This Apple sign-in could not be verified. Start sign-in again in this same browser tab.",
    );
  const session = tokenSession(
    await authRequest("/token?grant_type=pkce", {
      auth_code: params.get("code"),
      code_verifier: proof.verifier,
    }),
  );
  return acceptTokens(session, attempt);
}

export function signOut() {
  beginAuthentication();
  sessionStorage.removeItem(PROOF_KEY);
}

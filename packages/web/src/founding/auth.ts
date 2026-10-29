/** Customer authentication is deliberately separate from the admin session. */
export interface FoundingSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
export interface MembershipAccount {
  id: string;
  email: string;
}
const KEY = "persistence.founding.session";
const PENDING_KEY = "persistence.founding.pending-session";
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

function readSession(key: string): FoundingSession | null {
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

export function loadSession(): FoundingSession | null {
  return readSession(KEY);
}

function beginAuthentication() {
  generation += 1;
  saveSession(null);
  sessionStorage.removeItem(PENDING_KEY);
  return generation;
}

// Keep exchanged tokens separate until the authoritative identity read passes.
// A reload can retry that read without replaying Apple's single-use code.
async function finishPending(session: FoundingSession, attempt: number) {
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

async function acceptTokens(session: FoundingSession, attempt: number) {
  if (generation !== attempt)
    throw new Error("Your account changed. Please sign in again.");
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(session));
  return finishPending(session, attempt);
}

export function saveSession(session: FoundingSession | null) {
  if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
  else sessionStorage.removeItem(KEY);
}

async function authRequest(path: string, body?: unknown, accessToken?: string) {
  const cfg = authConfig();
  if (!cfg)
    throw new Error(
      "Founding access is not configured. Please contact Persistence support.",
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
      // Do not display provider payloads that may disclose account information.
      throw new Error(
        "We couldn't complete sign-in. Check your details or request an email sign-in link.",
      );
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function tokenSession(data: Record<string, unknown>): FoundingSession {
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
  session: FoundingSession,
): Promise<MembershipAccount> {
  const user = await authRequest("/user", undefined, session.accessToken);
  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    !user.email_confirmed_at
  )
    throw new Error("Verify your membership account email before continuing.");
  return { id: user.id, email: user.email };
}

let refresh: Promise<FoundingSession> | null = null;
export async function activeSession(): Promise<FoundingSession> {
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

const PROOF_KEY = "persistence.founding.auth-proof.";
const ACTIVE_PROOF_KEY = "persistence.founding.auth-flow";
const PLAN_KEY = "persistence.founding.selected-plan";
interface Proof {
  verifier: string;
  state: string;
  createdAt: number;
  plan: string | null;
  campaign: string | null;
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export function callbackUrl(state: string) {
  return `${window.location.origin}/founding/access/callback?flow=${encodeURIComponent(state)}`;
}
async function prepareProof() {
  const proof: Proof = {
    verifier: randomToken(),
    state: randomToken(),
    createdAt: Date.now(),
    plan: sessionStorage.getItem(PLAN_KEY),
    campaign: sessionStorage.getItem("persistence.founding.campaign"),
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(proof.verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  // Independent flow keys let email confirmation open in another tab without
  // overwriting an OAuth flow started elsewhere. Session tokens stay tab-local.
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(PROOF_KEY)) continue;
    try {
      const item = JSON.parse(localStorage.getItem(key) ?? "null");
      if (!item || Date.now() - item.createdAt > 60 * 60 * 1000)
        localStorage.removeItem(key);
    } catch {
      localStorage.removeItem(key);
    }
  }
  localStorage.setItem(PROOF_KEY + proof.state, JSON.stringify(proof));
  sessionStorage.setItem(ACTIVE_PROOF_KEY, proof.state);
  return { proof, challenge };
}
export async function oauthUrl(provider: "apple" | "google"): Promise<string> {
  const cfg = authConfig();
  if (!cfg)
    throw new Error(
      "Web sign-in is unavailable. Please contact Persistence support.",
    );
  const { proof, challenge } = await prepareProof();
  const url = new URL(`${cfg.url}/auth/v1/authorize`);
  url.search = new URLSearchParams({
    provider,
    redirect_to: callbackUrl(proof.state),
    code_challenge: challenge,
    code_challenge_method: "s256",
    ...(provider === "google" ? { prompt: "select_account" } : {}),
  }).toString();
  return url.toString();
}
export async function signUp(
  email: string,
  password: string,
): Promise<MembershipAccount | null> {
  const attempt = beginAuthentication();
  const { proof, challenge } = await prepareProof();
  const data = await authRequest(
    `/signup?redirect_to=${encodeURIComponent(callbackUrl(proof.state))}`,
    {
      email,
      password,
      code_challenge: challenge,
      code_challenge_method: "s256",
    },
  );
  if (!data.access_token) return null;
  const session = tokenSession(data);
  discardCurrentProof();
  return acceptTokens(session, attempt);
}
export async function sendSignInLink(email: string): Promise<void> {
  const { proof, challenge } = await prepareProof();
  await authRequest(
    `/otp?redirect_to=${encodeURIComponent(callbackUrl(proof.state))}`,
    {
      email,
      create_user: false,
      code_challenge: challenge,
      code_challenge_method: "s256",
    },
  );
}
/** Supabase verifies provider state; this additional nonce binds our return route
 * to this browser. PKCE proves that it initiated this exact authentication. */
export async function completeCallback(
  search: string,
  hash: string,
): Promise<MembershipAccount> {
  const params = new URLSearchParams(search);
  if (
    params.has("error") ||
    new URLSearchParams(hash.replace(/^#/, "")).has("error")
  ) {
    discardCurrentProof();
    throw new Error(
      "Sign-in was cancelled or could not be completed. Please try again. If Apple sign-in remains unavailable, contact support.",
    );
  }
  let proof: Proof | null = null;
  try {
    proof = JSON.parse(
      localStorage.getItem(PROOF_KEY + params.get("flow")) ?? "null",
    );
  } catch {
    /* invalid proof fails closed */
  }
  localStorage.removeItem(PROOF_KEY + params.get("flow"));
  if (
    !proof ||
    typeof proof.verifier !== "string" ||
    proof.verifier.length < 43 ||
    !proof.state ||
    params.get("flow") !== proof.state ||
    !Number.isFinite(proof.createdAt) ||
    Date.now() - proof.createdAt > 60 * 60 * 1000 ||
    proof.createdAt > Date.now() ||
    !params.get("code")
  ) {
    throw new Error(
      "This sign-in link could not be verified. Start sign-in again and open the link in this same browser.",
    );
  }
  const attempt = beginAuthentication();
  const session = tokenSession(
    await authRequest("/token?grant_type=pkce", {
      auth_code: params.get("code"),
      code_verifier: proof.verifier,
    }),
  );
  return acceptTokens(session, attempt);
}
export async function accountSession(
  expectedAccountId: string,
): Promise<FoundingSession> {
  const session = await activeSession();
  const account = await verifiedAccount(session);
  if (account.id !== expectedAccountId)
    throw new Error("Your account changed. Sign in again before continuing.");
  return session;
}
function discardCurrentProof() {
  const state = sessionStorage.getItem(ACTIVE_PROOF_KEY);
  if (state) localStorage.removeItem(PROOF_KEY + state);
  sessionStorage.removeItem(ACTIVE_PROOF_KEY);
}
export function callbackPlan(search: string): string | null {
  try {
    const state = new URLSearchParams(search).get("flow");
    const proof = JSON.parse(localStorage.getItem(PROOF_KEY + state) ?? "null");
    return proof?.state === state && typeof proof.plan === "string"
      ? proof.plan
      : null;
  } catch {
    return null;
  }
}
export function signOut() {
  beginAuthentication();
  discardCurrentProof();
}

export function callbackCampaign(search: string): string | null {
  try {
    const state = new URLSearchParams(search).get("flow");
    const proof = JSON.parse(localStorage.getItem(PROOF_KEY + state) ?? "null");
    return proof?.state === state && typeof proof.campaign === "string"
      ? proof.campaign
      : null;
  } catch {
    return null;
  }
}

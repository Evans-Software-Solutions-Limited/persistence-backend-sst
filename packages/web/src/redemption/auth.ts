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

export function authConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export function loadSession(): RedemptionSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
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
  const response = await fetch(`${cfg.url}/auth/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: cfg.key,
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429)
      throw new Error("Too many attempts. Please wait before trying again.");
    // Do not display provider payloads that may disclose account information.
    throw new Error(
      "We couldn't complete sign-in. Check your details or request an email sign-in link.",
    );
  }
  return data;
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
  if (!loadSession()) return null;
  return verifiedAccount(await activeSession());
}

export async function signIn(
  email: string,
  password: string,
): Promise<MembershipAccount> {
  const session = tokenSession(
    await authRequest("/token?grant_type=password", { email, password }),
  );
  const account = await verifiedAccount(session);
  saveSession(session);
  return account;
}

export function callbackUrl() {
  return `${window.location.origin}/redeem/callback`;
}

export async function signUp(
  email: string,
  password: string,
): Promise<MembershipAccount | null> {
  const data = await authRequest(
    `/signup?redirect_to=${encodeURIComponent(callbackUrl())}`,
    { email, password },
  );
  if (!data.access_token) return null;
  const session = tokenSession(data);
  const account = await verifiedAccount(session);
  saveSession(session);
  return account;
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
  const account = await verifiedAccount(session);
  saveSession(session);
  return account;
}

export function signOut() {
  saveSession(null);
}

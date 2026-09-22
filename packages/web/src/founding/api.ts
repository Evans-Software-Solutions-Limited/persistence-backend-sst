import { accountSession, signOut } from "./auth";
export interface ClaimResult {
  claimed: true;
  tierName: string;
  expiresAt: string;
}
async function post<T>(
  path: string,
  body: unknown,
  accountId: string,
): Promise<T> {
  const session = await accountSession(accountId);
  const base = import.meta.env.VITE_CORE_API_URL?.replace(/\/$/, "");
  if (!base)
    throw new Error("Founding access is unavailable. Please contact support.");
  const response = await fetch(`${base}/founding/claims/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      signOut();
      throw new Error(
        "Your sign-in expired. Change account and sign in again.",
      );
    }
    throw new Error(
      typeof result.message === "string"
        ? result.message
        : "Access could not be confirmed. Please try again.",
    );
  }
  if (!result.data)
    throw new Error("Access could not be confirmed. Please try again.");
  return result.data as T;
}
export interface AccountAccess {
  tierName: string;
  paymentStatus: string;
  expiresAt: string | null;
}
async function access(accountId: string): Promise<AccountAccess> {
  const session = await accountSession(accountId);
  const base = import.meta.env.VITE_CORE_API_URL?.replace(/\/$/, "");
  if (!base) throw new Error("Access could not be checked. Please try again.");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Access check timed out. Please try again."));
    }, 15_000);
  });
  try {
    return await Promise.race([
      timeout,
      (async () => {
        const response = await fetch(`${base}/subscriptions/me`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error("Access could not be checked. Please try again.");
        const body: unknown = await response.json();
        const data =
          body && typeof body === "object" && "data" in body ? body.data : null;
        if (
          !data ||
          typeof data !== "object" ||
          !("tierName" in data) ||
          typeof data.tierName !== "string" ||
          !data.tierName.trim() ||
          !("paymentStatus" in data) ||
          typeof data.paymentStatus !== "string" ||
          !data.paymentStatus.trim() ||
          !("expiresAt" in data) ||
          !(
            data.expiresAt === null ||
            (typeof data.expiresAt === "string" &&
              Number.isFinite(Date.parse(data.expiresAt)))
          )
        ) {
          throw new Error("Access could not be checked. Please try again.");
        }
        return {
          tierName: data.tierName,
          paymentStatus: data.paymentStatus,
          expiresAt: data.expiresAt,
        };
      })(),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export const foundingApi = {
  access,
  request: (email: string, accountId: string) =>
    post<{ challengeId: string }>("request", { email }, accountId),
  verify: (challengeId: string, code: string, accountId: string) =>
    post<ClaimResult>("verify", { challengeId, code }, accountId),
};

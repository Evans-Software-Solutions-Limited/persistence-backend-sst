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
export const foundingApi = {
  request: (email: string, accountId: string) =>
    post<{ challengeId: string }>("request", { email }, accountId),
  verify: (challengeId: string, code: string, accountId: string) =>
    post<ClaimResult>("verify", { challengeId, code }, accountId),
};

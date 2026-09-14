import { activeSession, signOut } from "./auth";

export interface Challenge {
  challengeId: string;
  verified: boolean;
  eligibilityEmail: string;
  accountEmail: string;
  businessName: string;
  tierName: string;
  months: number;
  expiresAt: string;
}
export interface Redemption {
  voucherId: string;
  businessName: string;
  tierName: string;
  months: number;
  eligibilityEmail: string;
  accountEmail: string;
  expiresAt: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const session = await activeSession();
  const base = import.meta.env.VITE_CORE_API_URL?.replace(/\/$/, "");
  if (!base)
    throw new Error(
      "Online redemption is not configured. Please contact Persistence support.",
    );
  const res = await fetch(`${base}/vouchers/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      signOut();
      throw new Error(
        "Your sign-in has expired. Change account below and sign in again.",
      );
    }
    throw new Error(
      typeof result.message === "string"
        ? result.message
        : "Redemption could not be completed. Please try again.",
    );
  }
  if (!result.data)
    throw new Error(
      "The server returned an incomplete response. Please try again.",
    );
  return result.data as T;
}
export const voucherApi = {
  prepare: (code: string, eligibilityEmail: string) =>
    post<Challenge>("prepare", { code, eligibilityEmail }),
  verify: (challengeId: string, otp: string) =>
    post<Challenge>("verify", { challengeId, otp }),
  redeem: (challengeId: string) => post<Redemption>("redeem", { challengeId }),
};

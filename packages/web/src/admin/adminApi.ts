import { getAccessToken, saveSession } from "./adminAuth";

/**
 * Thin fetch wrapper for the `/admin/*` API (FRONTEND_BRIEF § W1). Deliberately
 * NOT `eden.ts` — `treaty<CoreApi>` is at the TS2589 ceiling. Types below are a
 * hand-kept mirror of the handlers in `microservices/core/src/application/admin`.
 */

export class AdminApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
  constructor(status: number, body: Record<string, unknown> | null) {
    super(
      typeof body?.message === "string"
        ? body.message
        : `Request failed (${status})`,
    );
    this.status = status;
    this.body = body;
    this.name = "AdminApiError";
  }
}

export function apiBase(): string {
  return (import.meta.env.VITE_CORE_API_URL ?? "").replace(/\/$/, "");
}

export async function adminFetch<T>(
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new AdminApiError(401, { message: "Signed out" });
  const res = await fetchImpl(`${apiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) saveSession(null);
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw new AdminApiError(res.status, body);
  return body as T;
}

// ─── Types ────────────────────────────────────────────────────────────────

export type FoundingTierName =
  | "premium"
  | "premium_plus"
  | "start_up_coach_plus";
export type PaymentMethod =
  | "bank_transfer"
  | "stripe_link"
  | "card_in_person"
  | "other";

export interface Catalogue {
  offers: Record<
    FoundingTierName,
    { months: number; priceMinor: number; pool: string; label: string }
  >;
  caps: Record<string, number>;
  paymentMethods: PaymentMethod[];
}

export interface Summary {
  founding: {
    pools: Record<"consumer" | "coach", { used: number; cap: number }>;
    byTier: Array<{ tierName: string; count: number; revenueMinor: number }>;
    revenueMinor: number;
    pending: number;
  };
  referrals: { codes: number; claims: number; lockedClaims: number };
  recentGrants: GrantRow[];
}

export interface GrantRow {
  id: string;
  userId: string | null;
  email: string;
  tierName: string;
  tierLabel: string | null;
  months: number;
  amountMinor: number;
  currency: string;
  paymentMethod: string;
  paymentReference: string | null;
  paidAt: string;
  referralCode: string | null;
  referralLabel: string | null;
  subscriptionExpiresAt: string | null;
  invitedAt: string | null;
  appliedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  notes: string | null;
  createdAt: string;
  status: "pending" | "active" | "expired" | "revoked" | "account_deleted";
}

export interface GrantResult {
  grantId: string;
  status: "active" | "pending";
  email: string;
  userId: string | null;
  tierName: FoundingTierName;
  expiresAt: string | null;
  invited: boolean;
  inviteError: string | null;
  seats: { pool: string; used: number; cap: number };
  referral: { code: string; label: string } | null;
}

export interface NewGrantInput {
  email: string;
  tierName: FoundingTierName;
  amountMinor?: number;
  paymentMethod: PaymentMethod;
  paymentReference?: string | null;
  paidAt?: string;
  referralCode?: string | null;
  notes?: string | null;
  allowRoleChange?: boolean;
  allowSupersedeStoreSubscription?: boolean;
  sendInvite?: boolean;
}

export interface ReferralCodeRow {
  id: string;
  code: string;
  displayCode: string;
  label: string;
  partnerName: string | null;
  kind: "vendor" | "campaign" | "founding" | "internal";
  status: "active" | "paused" | "archived";
  maxRedemptions: number | null;
  redemptionCount: number;
  startsAt: string | null;
  endsAt: string | null;
  campaignSlug: string | null;
  notes: string | null;
  createdAt: string;
  grantCount: number;
  paidCount: number;
}

export interface UserLookup {
  account: {
    id: string;
    email: string | null;
    role: string | null;
    subscription: {
      tierName: string;
      paymentStatus: string;
      expiresAt: string | null;
      cancelledAt: string | null;
      externalSubscriptionId: string | null;
      fromStore: boolean;
    } | null;
    attribution: {
      code: string;
      label: string;
      lockedAt: string | null;
    } | null;
    foundingGrants: GrantRow[];
  } | null;
  pendingGrants: Array<{
    id: string;
    tierName: string;
    paidAt: string;
    invitedAt: string | null;
  }>;
}

export interface AuditRow {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
}

// ─── Calls ────────────────────────────────────────────────────────────────

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const adminApi = {
  summary: () => data(adminFetch<{ data: Summary }>("/admin/summary")),
  catalogue: () =>
    data(adminFetch<{ data: Catalogue }>("/admin/founding-grants/catalogue")),
  lookupUser: (email: string) =>
    data(
      adminFetch<{ data: UserLookup }>(
        `/admin/users?email=${encodeURIComponent(email)}`,
      ),
    ),
  grants: (revoked?: boolean) =>
    data(
      adminFetch<{ data: GrantRow[] }>(
        `/admin/founding-grants${revoked === undefined ? "" : `?revoked=${revoked}`}`,
      ),
    ),
  createGrant: (input: NewGrantInput) =>
    data(
      adminFetch<{ data: GrantResult }>("/admin/founding-grants", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  revokeGrant: (id: string, reason: string) =>
    adminFetch<{ data: unknown }>(`/admin/founding-grants/${id}/revoke`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  resendInvite: (id: string) =>
    adminFetch<{ data: unknown }>(
      `/admin/founding-grants/${id}/resend-invite`,
      { method: "POST" },
    ),
  codes: (q?: string, status?: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const qs = params.toString();
    return data(
      adminFetch<{ data: ReferralCodeRow[] }>(
        `/admin/referral-codes${qs ? `?${qs}` : ""}`,
      ),
    );
  },
  createCode: (input: {
    code: string;
    label: string;
    partnerName?: string | null;
    kind: ReferralCodeRow["kind"];
    maxRedemptions?: number | null;
    campaignSlug?: string | null;
    notes?: string | null;
  }) =>
    data(
      adminFetch<{ data: ReferralCodeRow }>("/admin/referral-codes", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  updateCode: (
    id: string,
    patch: Partial<
      Pick<
        ReferralCodeRow,
        "status" | "label" | "partnerName" | "maxRedemptions" | "notes"
      >
    >,
  ) =>
    data(
      adminFetch<{ data: ReferralCodeRow }>(`/admin/referral-codes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    ),
  redemptions: (id: string) =>
    data(
      adminFetch<{
        data: Array<{
          userId: string;
          email: string | null;
          source: string;
          lockedAt: string | null;
          createdAt: string;
        }>;
      }>(`/admin/referral-codes/${id}/redemptions`),
    ),
  setAttribution: (userId: string, code: string, reason: string) =>
    adminFetch<{ data: unknown }>("/admin/referral-attributions", {
      method: "POST",
      body: JSON.stringify({ userId, code, reason }),
    }),
  audit: (entityType?: string, entityId?: string) => {
    const params = new URLSearchParams();
    if (entityType) params.set("entityType", entityType);
    if (entityId) params.set("entityId", entityId);
    const qs = params.toString();
    return data(
      adminFetch<{ data: AuditRow[] }>(`/admin/audit-log${qs ? `?${qs}` : ""}`),
    );
  },
};

export function formatMinor(minor: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    minor / 100,
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

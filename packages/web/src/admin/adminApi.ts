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
    { months: number; pool: string; label: string }
  >;
  caps: Record<"consumer" | "coach", number>;
  contributionMethods: PaymentMethod[];
}

export interface Summary {
  founding: {
    pools: Record<"consumer" | "coach", { used: number; cap: number }>;
    byTier: Array<{
      tierName: string;
      count: number;
      contributionMinor: number;
    }>;
    contributionMinor: number;
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
  grantKind: "founding" | "complimentary";
  contributionAmountMinor: number;
  contributionCurrency: string;
  contributionMethod: string | null;
  contributionReference: string | null;
  contributedAt: string | null;
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
  grantKind: "founding" | "complimentary";
  months: number;
  expiresAt: string | null;
  invited: boolean;
  inviteError: string | null;
  seats: { pool: string; used: number; cap: number } | null;
  referral: { code: string; label: string } | null;
}

export interface NewGrantInput {
  email: string;
  tierName: FoundingTierName;
  grantKind: "founding" | "complimentary";
  months: number;
  contributionAmountMinor?: number;
  contributionCurrency?: string;
  contributionMethod?: PaymentMethod;
  contributionReference?: string | null;
  contributedAt?: string;
  referralCode?: string | null;
  notes?: string | null;
  allowRoleChange?: boolean;
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
    months: number;
    invitedAt: string | null;
  }>;
}

// ─── Marketing plans (MARKETING-PLANS) ────────────────────────────────────

export type PlanStatus = "draft" | "active" | "paused" | "complete";
/** The rails a plan runs. `founding_access` has no price; `store_offer` does. */
export type OfferLane = "founding_access" | "store_offer";

export interface MarketingPlanRow {
  id: string;
  name: string;
  slug: string;
  status: PlanStatus;
  objective: string | null;
  hypothesis: string | null;
  decisionRule: string | null;
  offerLanes: string[];
  budgetCapMinor: number | null;
  currency: string;
  startsOn: string | null;
  endsOn: string | null;
  briefMd: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingPlanListRow extends MarketingPlanRow {
  channelsCount: number;
  spendMinor: number;
  storeClicks: number;
  grants: number;
}

export interface PlanChannel {
  id: string;
  campaignSlug: string;
  label: string;
  placement: string | null;
  notes: string | null;
}

export interface PlanLinkedCode {
  linkId: string;
  codeId: string;
  code: string;
  displayCode: string;
  label: string;
  partnerName: string | null;
  campaignSlug: string | null;
}

/**
 * A record of an offer configured in App Store Connect / the Play Console.
 * Never authoritative — see the note the detail page renders beside the table.
 */
export interface PlanStoreOffer {
  id: string;
  platform: "ios" | "android";
  code: string;
  tierName: string;
  durationMonths: number;
  priceMinor: number;
  currency: string;
  maxRedemptions: number | null;
  expiresOn: string | null;
  campaignSlug: string | null;
  redemptionUrl: string | null;
  notes: string | null;
}

export interface PlanMetric {
  id: string;
  campaignSlug: string | null;
  metricDate: string;
  spendMinor: number | null;
  impressions: number | null;
  clicks: number | null;
  landingViews: number | null;
  storeRedemptions: number | null;
  notes: string | null;
}

export interface ChannelAttribution {
  campaignSlug: string;
  storeClicks: number;
  storeClicksIos: number;
  storeClicksAndroid: number;
  storeClicksWithCode: number;
}

export interface CodeAttribution {
  codeId: string;
  referralClaims: number;
  referralClaimsLocked: number;
  grantsFounding: number;
  grantsComplimentary: number;
  grantsPending: number;
  grantsApplied: number;
  /** Optional contributions. Not revenue — never label it as such. */
  contributionMinor: number;
}

export interface MarketingPlanDetail {
  plan: MarketingPlanRow;
  channels: PlanChannel[];
  codes: PlanLinkedCode[];
  storeOffers: PlanStoreOffer[];
  metrics: PlanMetric[];
  attribution: {
    /** Plain calendar days (`YYYY-MM-DD`); render with `formatDay`. */
    window: { from: string; to: string };
    channels: ChannelAttribution[];
    codes: CodeAttribution[];
    /** Cannot be split by channel — display as "all sources". */
    registrationsAllSources: number;
  };
}

export interface NewPlanInput {
  name: string;
  slug: string;
  objective?: string | null;
  hypothesis?: string | null;
  decisionRule?: string | null;
  offerLanes: OfferLane[];
  budgetCapMinor?: number | null;
  startsOn?: string | null;
  endsOn?: string | null;
  briefMd?: string | null;
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
  extendGrant: (id: string, additionalMonths: number, reason: string) =>
    data(
      adminFetch<{
        data: { id: string; months: number; expiresAt: string | null };
      }>(`/admin/founding-grants/${id}/extend`, {
        method: "POST",
        body: JSON.stringify({ additionalMonths, reason }),
      }),
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
  campaignSlugs: () =>
    data(
      adminFetch<{ data: { slugs: string[] } }>(
        "/admin/marketing/campaign-slugs",
      ),
    ).then((d) => d.slugs),
  marketingPlans: (status?: string) =>
    data(
      adminFetch<{ data: MarketingPlanListRow[] }>(
        `/admin/marketing/plans${status ? `?status=${status}` : ""}`,
      ),
    ),
  marketingPlan: (id: string) =>
    data(
      adminFetch<{ data: MarketingPlanDetail }>(`/admin/marketing/plans/${id}`),
    ),
  createMarketingPlan: (input: NewPlanInput) =>
    data(
      adminFetch<{ data: MarketingPlanRow }>("/admin/marketing/plans", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  updateMarketingPlan: (
    id: string,
    patch: Partial<NewPlanInput> & { status?: PlanStatus },
  ) =>
    data(
      adminFetch<{ data: MarketingPlanRow }>(`/admin/marketing/plans/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    ),
  addPlanChannel: (
    id: string,
    input: { campaignSlug: string; label: string; placement?: string | null },
  ) =>
    data(
      adminFetch<{ data: PlanChannel }>(
        `/admin/marketing/plans/${id}/channels`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ),
  removePlanChannel: (id: string, channelId: string) =>
    adminFetch<{ data: unknown }>(
      `/admin/marketing/plans/${id}/channels/${channelId}`,
      { method: "DELETE" },
    ),
  // Link only — the code must already exist in /admin → Referral codes.
  linkPlanCode: (
    id: string,
    input: { referralCodeId: string; campaignSlug?: string | null },
  ) =>
    data(
      adminFetch<{ data: { id: string; code: string } }>(
        `/admin/marketing/plans/${id}/codes`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ),
  unlinkPlanCode: (id: string, linkId: string) =>
    adminFetch<{ data: unknown }>(
      `/admin/marketing/plans/${id}/codes/${linkId}`,
      { method: "DELETE" },
    ),
  addPlanStoreOffer: (
    id: string,
    input: Omit<PlanStoreOffer, "id" | "currency"> & { currency?: string },
  ) =>
    data(
      adminFetch<{ data: PlanStoreOffer }>(
        `/admin/marketing/plans/${id}/store-offers`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    ),
  updatePlanStoreOffer: (
    id: string,
    offerId: string,
    patch: Partial<Omit<PlanStoreOffer, "id" | "platform" | "code">>,
  ) =>
    data(
      adminFetch<{ data: PlanStoreOffer }>(
        `/admin/marketing/plans/${id}/store-offers/${offerId}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      ),
    ),
  removePlanStoreOffer: (id: string, offerId: string) =>
    adminFetch<{ data: unknown }>(
      `/admin/marketing/plans/${id}/store-offers/${offerId}`,
      { method: "DELETE" },
    ),
  upsertPlanMetric: (
    id: string,
    input: Omit<PlanMetric, "id"> & { campaignSlug: string | null },
  ) =>
    data(
      adminFetch<{ data: PlanMetric }>(`/admin/marketing/plans/${id}/metrics`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    ),
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

/**
 * A plain calendar day (`YYYY-MM-DD`, as every DATE column serialises) in the
 * site's display format.
 *
 * NOT `formatDate`: `new Date("2026-09-12")` is midnight UTC, which is the
 * 11th anywhere west of Greenwich, so an instant formatter silently shifts
 * campaign start and end dates by a day for some viewers. Parsing the parts
 * into a LOCAL date keeps the day the admin typed the day the admin sees.
 */
export function formatDay(day: string | null | undefined): string {
  if (!day) return "—";
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!parts) return formatDate(day);
  const [, year, month, date] = parts;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(date),
  ).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Today as a plain calendar day (`YYYY-MM-DD`), in the ADMIN'S timezone.
 *
 * The counterpart to `formatDay`, for prefilling a date input. NOT
 * `new Date().toISOString().slice(0, 10)`, which is the UTC day: at 08:00 in
 * Tokyo that reads yesterday, and at 18:00 in Los Angeles it reads tomorrow.
 * A form defaulted that way records the row against the wrong `metric_date`
 * for anyone who tabs past the picker — and because those rows are upserted by
 * day, the correct value later overwrites, so a day's spend is silently filed
 * under its neighbour.
 */
export function todayIsoDay(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
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

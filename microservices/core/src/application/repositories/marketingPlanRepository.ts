import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  analyticsEvents,
  foundingGrants,
  marketingPlanChannels,
  marketingPlanCodes,
  marketingPlanMetrics,
  marketingPlanStoreOffers,
  marketingPlans,
  referralCodes,
  referralRedemptions,
  type MarketingPlan,
  type MarketingPlanChannel,
  type MarketingPlanMetric,
  type MarketingPlanStoreOffer,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DatabaseTransaction } from "./referralRepository";

/**
 * Marketing plans and the attribution derived from them (MARKETING-PLANS § WP5).
 *
 * ─── Admin-scoped, deliberately ───
 *
 * Every other repository in this directory takes `userId` first and filters by
 * it, because every other repository serves a user. These rows have no user:
 * they are Brad's own campaign records. `adminGuard` (JWT
 * `app_metadata.admin`) is the authorisation, and the tables carry RLS with no
 * policies so nothing but the service role can reach them at all.
 *
 * ─── What "attribution" means here, and what it does not ───
 *
 * Nothing below computes revenue, CAC or ROAS, and nothing may start to.
 * Founding grants are ACCESS, granted at Brad's discretion; the amounts on
 * them are optional contributions that are legally and technically separate
 * from that access (FOUNDING-OFFER 2026-09-04 amendment). So the contribution
 * total returned per code is labelled as a contribution everywhere it
 * surfaces, and no per-grant price exists to divide spend by.
 *
 * `registration_completed` carries no channel — it is emitted server-side on
 * sign-up, long after any campaign context is gone — so it is returned as a
 * plan-window total only. Splitting it per channel would mean inventing an
 * attribution the data cannot support.
 */

type Tx = DatabaseTransaction;

export interface PlanWindow {
  from: Date;
  /** Exclusive. */
  to: Date;
}

export interface CreatePlanInput {
  name: string;
  slug: string;
  objective?: string | null;
  hypothesis?: string | null;
  decisionRule?: string | null;
  offerLanes: string[];
  budgetCapMinor?: number | null;
  currency?: string;
  startsOn?: string | null;
  endsOn?: string | null;
  briefMd?: string | null;
  createdBy: string;
}

export interface UpdatePlanInput {
  name?: string;
  status?: "draft" | "active" | "paused" | "complete";
  objective?: string | null;
  hypothesis?: string | null;
  decisionRule?: string | null;
  offerLanes?: string[];
  budgetCapMinor?: number | null;
  currency?: string;
  startsOn?: string | null;
  endsOn?: string | null;
  briefMd?: string | null;
}

export interface PlanListRow extends MarketingPlan {
  channelsCount: number;
  spendMinor: number;
  storeClicks: number;
  grants: number;
}

export interface StoreOfferInput {
  platform: "ios" | "android";
  code: string;
  tierName: string;
  durationMonths: number;
  priceMinor: number;
  currency?: string;
  maxRedemptions?: number | null;
  expiresOn?: string | null;
  campaignSlug?: string | null;
  redemptionUrl?: string | null;
  notes?: string | null;
}

export interface MetricInput {
  campaignSlug: string | null;
  metricDate: string;
  spendMinor?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  landingViews?: number | null;
  storeRedemptions?: number | null;
  notes?: string | null;
  recordedBy: string;
}

export interface LinkedCode {
  linkId: string;
  codeId: string;
  code: string;
  displayCode: string;
  label: string;
  partnerName: string | null;
  campaignSlug: string | null;
}

export interface ChannelClicks {
  campaignSlug: string;
  storeClicks: number;
  storeClicksIos: number;
  storeClicksAndroid: number;
  /** Clicks whose `ref` was one of this plan's linked codes. */
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
  /**
   * Sum of the OPTIONAL contributions recorded against those grants. Not
   * revenue, not a price, and never a divisor for spend — see the file header.
   */
  contributionMinor: number;
}

/** `properties->>'campaign'` — no bound parameters, so safe to restate. */
const eventCampaign = sql<string>`${analyticsEvents.properties} ->> 'campaign'`;
const eventStore = sql<string>`${analyticsEvents.properties} ->> 'store'`;
const eventRef = sql<string>`${analyticsEvents.properties} ->> 'ref'`;

function num(value: unknown): number {
  return Number(value ?? 0);
}

export class MarketingPlanRepository {
  // ─── Plans ──────────────────────────────────────────────────────────────

  /**
   * Plans with their roll-up counters.
   *
   * FIVE queries stitched in TypeScript rather than one with correlated
   * sub-selects, and that is not a style choice.
   *
   * Drizzle renders a column reference inside a `sql` template UNQUALIFIED
   * when the statement has a single FROM table — `${marketingPlans.id}`
   * becomes `"id"`, not `"marketing_plans"."id"`. Inside a correlated
   * sub-select over `marketing_plan_channels`, which has an `id` of its own,
   * `WHERE "plan_id" = "id"` therefore binds to the INNER table and is
   * silently always false. It parses, it runs, and every counter comes back
   * zero. That exact shape was written first here and every roll-up was 0.
   *
   * A join qualifies both sides, so each counter below is its own small
   * grouped query and the ambiguity cannot arise. Admin plans number in the
   * tens, so the extra round trips cost nothing.
   */
  async listPlans(filter: {
    status?: "draft" | "active" | "paused" | "complete";
  }): Promise<PlanListRow[]> {
    const db = getDb();
    const plans = await db
      .select()
      .from(marketingPlans)
      .where(
        filter.status ? eq(marketingPlans.status, filter.status) : undefined,
      )
      .orderBy(desc(marketingPlans.createdAt));
    if (plans.length === 0) return [];
    const planIds = plans.map((p) => p.id);

    const [channelCounts, spend, clicks, grants] = await Promise.all([
      db
        .select({
          planId: marketingPlanChannels.planId,
          n: sql<number>`count(*)::int`,
        })
        .from(marketingPlanChannels)
        .where(inArray(marketingPlanChannels.planId, planIds))
        .groupBy(marketingPlanChannels.planId),
      db
        .select({
          planId: marketingPlanMetrics.planId,
          n: sql<number>`coalesce(sum(${marketingPlanMetrics.spendMinor}), 0)::int`,
        })
        .from(marketingPlanMetrics)
        .where(inArray(marketingPlanMetrics.planId, planIds))
        .groupBy(marketingPlanMetrics.planId),
      // Store clicks for any channel of the plan, over the plan's whole life.
      // The detail view narrows this to the plan window; the list is a "has
      // this produced anything at all" glance.
      db
        .select({
          planId: marketingPlanChannels.planId,
          n: sql<number>`count(*)::int`,
        })
        .from(marketingPlanChannels)
        .innerJoin(
          analyticsEvents,
          and(
            eq(analyticsEvents.eventName, "store_click"),
            eq(eventCampaign, marketingPlanChannels.campaignSlug),
          ),
        )
        .where(inArray(marketingPlanChannels.planId, planIds))
        .groupBy(marketingPlanChannels.planId),
      db
        .select({
          planId: marketingPlanCodes.planId,
          n: sql<number>`count(*)::int`,
        })
        .from(marketingPlanCodes)
        .innerJoin(
          foundingGrants,
          and(
            eq(
              foundingGrants.referralCodeId,
              marketingPlanCodes.referralCodeId,
            ),
            isNull(foundingGrants.revokedAt),
          ),
        )
        .where(inArray(marketingPlanCodes.planId, planIds))
        .groupBy(marketingPlanCodes.planId),
    ]);

    const byPlan = (rows: Array<{ planId: string; n: number }>) =>
      new Map(rows.map((r) => [r.planId, num(r.n)]));
    const channelsBy = byPlan(channelCounts);
    const spendBy = byPlan(spend);
    const clicksBy = byPlan(clicks);
    const grantsBy = byPlan(grants);

    return plans.map((plan) => ({
      ...plan,
      channelsCount: channelsBy.get(plan.id) ?? 0,
      spendMinor: spendBy.get(plan.id) ?? 0,
      storeClicks: clicksBy.get(plan.id) ?? 0,
      grants: grantsBy.get(plan.id) ?? 0,
    }));
  }

  async findPlan(id: string): Promise<MarketingPlan | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(marketingPlans)
      .where(eq(marketingPlans.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findPlanForUpdate(tx: Tx, id: string): Promise<MarketingPlan | null> {
    const rows = await tx
      .select()
      .from(marketingPlans)
      .where(eq(marketingPlans.id, id))
      .limit(1)
      .for("update");
    return rows[0] ?? null;
  }

  async createPlanIn(tx: Tx, input: CreatePlanInput): Promise<MarketingPlan> {
    const [row] = await tx
      .insert(marketingPlans)
      .values({
        name: input.name,
        slug: input.slug,
        objective: input.objective ?? null,
        hypothesis: input.hypothesis ?? null,
        decisionRule: input.decisionRule ?? null,
        offerLanes: input.offerLanes,
        budgetCapMinor: input.budgetCapMinor ?? null,
        currency: input.currency ?? "GBP",
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
        briefMd: input.briefMd ?? null,
        createdBy: input.createdBy,
      })
      .returning();
    return row!;
  }

  async updatePlanIn(
    tx: Tx,
    id: string,
    patch: UpdatePlanInput,
  ): Promise<MarketingPlan | null> {
    const [row] = await tx
      .update(marketingPlans)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(marketingPlans.id, id))
      .returning();
    return row ?? null;
  }

  // ─── Channels ───────────────────────────────────────────────────────────

  async listChannels(planId: string): Promise<MarketingPlanChannel[]> {
    const db = getDb();
    return db
      .select()
      .from(marketingPlanChannels)
      .where(eq(marketingPlanChannels.planId, planId))
      .orderBy(asc(marketingPlanChannels.campaignSlug));
  }

  async addChannelIn(
    tx: Tx,
    planId: string,
    input: {
      campaignSlug: string;
      label: string;
      placement?: string | null;
      notes?: string | null;
    },
  ): Promise<MarketingPlanChannel> {
    const [row] = await tx
      .insert(marketingPlanChannels)
      .values({
        planId,
        campaignSlug: input.campaignSlug,
        label: input.label,
        placement: input.placement ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    return row!;
  }

  async removeChannelIn(
    tx: Tx,
    planId: string,
    channelId: string,
  ): Promise<MarketingPlanChannel | null> {
    const [row] = await tx
      .delete(marketingPlanChannels)
      .where(
        and(
          eq(marketingPlanChannels.id, channelId),
          eq(marketingPlanChannels.planId, planId),
        ),
      )
      .returning();
    return row ?? null;
  }

  // ─── Linked referral codes (link only — codes are created elsewhere) ─────

  async listLinkedCodes(planId: string): Promise<LinkedCode[]> {
    const db = getDb();
    const rows = await db
      .select({
        linkId: marketingPlanCodes.id,
        codeId: referralCodes.id,
        code: referralCodes.code,
        displayCode: referralCodes.displayCode,
        label: referralCodes.label,
        partnerName: referralCodes.partnerName,
        campaignSlug: marketingPlanCodes.campaignSlug,
      })
      .from(marketingPlanCodes)
      .innerJoin(
        referralCodes,
        eq(referralCodes.id, marketingPlanCodes.referralCodeId),
      )
      .where(eq(marketingPlanCodes.planId, planId))
      .orderBy(asc(referralCodes.code));
    return rows;
  }

  async linkCodeIn(
    tx: Tx,
    planId: string,
    referralCodeId: string,
    campaignSlug: string | null,
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(marketingPlanCodes)
      .values({ planId, referralCodeId, campaignSlug })
      .returning({ id: marketingPlanCodes.id });
    return row!;
  }

  async unlinkCodeIn(
    tx: Tx,
    planId: string,
    linkId: string,
  ): Promise<{ id: string; referralCodeId: string } | null> {
    const [row] = await tx
      .delete(marketingPlanCodes)
      .where(
        and(
          eq(marketingPlanCodes.id, linkId),
          eq(marketingPlanCodes.planId, planId),
        ),
      )
      .returning({
        id: marketingPlanCodes.id,
        referralCodeId: marketingPlanCodes.referralCodeId,
      });
    return row ?? null;
  }

  // ─── Store offers (a mirror of App Store Connect, never a control) ───────

  async listStoreOffers(planId: string): Promise<MarketingPlanStoreOffer[]> {
    const db = getDb();
    return db
      .select()
      .from(marketingPlanStoreOffers)
      .where(eq(marketingPlanStoreOffers.planId, planId))
      .orderBy(
        asc(marketingPlanStoreOffers.platform),
        asc(marketingPlanStoreOffers.code),
      );
  }

  async addStoreOfferIn(
    tx: Tx,
    planId: string,
    input: StoreOfferInput,
  ): Promise<MarketingPlanStoreOffer> {
    const [row] = await tx
      .insert(marketingPlanStoreOffers)
      .values({
        planId,
        platform: input.platform,
        code: input.code,
        tierName: input.tierName,
        durationMonths: input.durationMonths,
        priceMinor: input.priceMinor,
        currency: input.currency ?? "GBP",
        maxRedemptions: input.maxRedemptions ?? null,
        expiresOn: input.expiresOn ?? null,
        campaignSlug: input.campaignSlug ?? null,
        redemptionUrl: input.redemptionUrl ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    return row!;
  }

  async updateStoreOfferIn(
    tx: Tx,
    planId: string,
    offerId: string,
    patch: Partial<StoreOfferInput>,
  ): Promise<MarketingPlanStoreOffer | null> {
    const [row] = await tx
      .update(marketingPlanStoreOffers)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(marketingPlanStoreOffers.id, offerId),
          eq(marketingPlanStoreOffers.planId, planId),
        ),
      )
      .returning();
    return row ?? null;
  }

  async removeStoreOfferIn(
    tx: Tx,
    planId: string,
    offerId: string,
  ): Promise<MarketingPlanStoreOffer | null> {
    const [row] = await tx
      .delete(marketingPlanStoreOffers)
      .where(
        and(
          eq(marketingPlanStoreOffers.id, offerId),
          eq(marketingPlanStoreOffers.planId, planId),
        ),
      )
      .returning();
    return row ?? null;
  }

  // ─── Hand-entered metrics ───────────────────────────────────────────────

  async listMetrics(planId: string): Promise<MarketingPlanMetric[]> {
    const db = getDb();
    return db
      .select()
      .from(marketingPlanMetrics)
      .where(eq(marketingPlanMetrics.planId, planId))
      .orderBy(
        desc(marketingPlanMetrics.metricDate),
        asc(marketingPlanMetrics.campaignSlug),
      );
  }

  /**
   * Upsert one dated row, keyed by `(plan, channel-or-whole-plan, date)`.
   *
   * Insert-then-update rather than `onConflictDoUpdate`: the uniqueness that
   * defines this row lives in an EXPRESSION index over
   * `COALESCE(campaign_slug, '*')`, and Drizzle's conflict target takes bare
   * columns only. Naming the three columns instead would silently target
   * nothing (there is no such constraint) and every re-entry of a week's
   * numbers would append a duplicate row.
   *
   * `IS NOT DISTINCT FROM` on the slug, not `=`: the whole-plan row's slug is
   * NULL, and `NULL = NULL` is NULL, so `=` would never find it to update.
   *
   * The index remains the real guarantee. Two admins racing the same date get
   * a unique violation on the insert rather than two rows — a visible failure
   * instead of a silently doubled spend figure.
   */
  async upsertMetricIn(
    tx: Tx,
    planId: string,
    input: MetricInput,
  ): Promise<MarketingPlanMetric> {
    const values = {
      spendMinor: input.spendMinor ?? null,
      impressions: input.impressions ?? null,
      clicks: input.clicks ?? null,
      landingViews: input.landingViews ?? null,
      storeRedemptions: input.storeRedemptions ?? null,
      notes: input.notes ?? null,
      recordedBy: input.recordedBy,
    };
    const [updated] = await tx
      .update(marketingPlanMetrics)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(marketingPlanMetrics.planId, planId),
          sql`${marketingPlanMetrics.campaignSlug} IS NOT DISTINCT FROM ${input.campaignSlug}`,
          eq(marketingPlanMetrics.metricDate, input.metricDate),
        ),
      )
      .returning();
    if (updated) return updated;
    const [inserted] = await tx
      .insert(marketingPlanMetrics)
      .values({
        planId,
        campaignSlug: input.campaignSlug,
        metricDate: input.metricDate,
        ...values,
      })
      .returning();
    return inserted!;
  }

  // ─── Derived attribution, scoped to the plan window ─────────────────────

  /**
   * Store clicks per channel, split by destination store, plus how many
   * carried one of the plan's linked referral codes.
   *
   * `codes` are the CANONICAL upper-case code words — the shape
   * `store_click.properties.ref` is normalised to by the marketing site.
   */
  async storeClicksByChannel(
    slugs: string[],
    codes: string[],
    window: PlanWindow,
  ): Promise<ChannelClicks[]> {
    if (slugs.length === 0) return [];
    const db = getDb();
    const rows = await db
      .select({
        campaignSlug: eventCampaign,
        total: sql<number>`count(*)::int`,
        ios: sql<number>`count(*) FILTER (WHERE ${eventStore} = 'ios')::int`,
        android: sql<number>`count(*) FILTER (WHERE ${eventStore} = 'android')::int`,
        withCode:
          codes.length > 0
            ? sql<number>`count(*) FILTER (WHERE ${eventRef} IN ${codes})::int`
            : sql<number>`0::int`,
      })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.eventName, "store_click"),
          gte(analyticsEvents.occurredAt, window.from),
          lt(analyticsEvents.occurredAt, window.to),
          inArray(eventCampaign, slugs),
        ),
      )
      .groupBy(eventCampaign);
    const found = new Map(
      rows.map((r) => [
        r.campaignSlug,
        {
          campaignSlug: r.campaignSlug,
          storeClicks: num(r.total),
          storeClicksIos: num(r.ios),
          storeClicksAndroid: num(r.android),
          storeClicksWithCode: num(r.withCode),
        },
      ]),
    );
    // A channel with no clicks must still appear as a zero row — an absent row
    // reads as "not set up" rather than "set up and producing nothing", which
    // is the whole question a spend decision turns on.
    return slugs.map(
      (slug) =>
        found.get(slug) ?? {
          campaignSlug: slug,
          storeClicks: 0,
          storeClicksIos: 0,
          storeClicksAndroid: 0,
          storeClicksWithCode: 0,
        },
    );
  }

  /** Claims, grants and optional contributions per linked code, in-window. */
  async attributionByCode(
    codeIds: string[],
    window: PlanWindow,
  ): Promise<CodeAttribution[]> {
    if (codeIds.length === 0) return [];
    const db = getDb();
    const claims = await db
      .select({
        codeId: referralRedemptions.codeId,
        total: sql<number>`count(*)::int`,
        locked: sql<number>`count(${referralRedemptions.lockedAt})::int`,
      })
      .from(referralRedemptions)
      .where(
        and(
          inArray(referralRedemptions.codeId, codeIds),
          gte(referralRedemptions.createdAt, window.from),
          lt(referralRedemptions.createdAt, window.to),
        ),
      )
      .groupBy(referralRedemptions.codeId);

    const grants = await db
      .select({
        codeId: foundingGrants.referralCodeId,
        founding: sql<number>`count(*) FILTER (WHERE ${foundingGrants.grantKind} = 'founding')::int`,
        complimentary: sql<number>`count(*) FILTER (WHERE ${foundingGrants.grantKind} = 'complimentary')::int`,
        pending: sql<number>`count(*) FILTER (WHERE ${foundingGrants.appliedAt} IS NULL)::int`,
        applied: sql<number>`count(*) FILTER (WHERE ${foundingGrants.appliedAt} IS NOT NULL)::int`,
        contributionMinor: sql<number>`coalesce(sum(${foundingGrants.amountMinor}), 0)::int`,
      })
      .from(foundingGrants)
      .where(
        and(
          inArray(foundingGrants.referralCodeId, codeIds),
          isNull(foundingGrants.revokedAt),
          gte(foundingGrants.createdAt, window.from),
          lt(foundingGrants.createdAt, window.to),
        ),
      )
      .groupBy(foundingGrants.referralCodeId);

    const claimBy = new Map(claims.map((r) => [r.codeId, r]));
    const grantBy = new Map(grants.map((r) => [r.codeId, r]));
    return codeIds.map((codeId) => {
      const c = claimBy.get(codeId);
      const g = grantBy.get(codeId);
      return {
        codeId,
        referralClaims: num(c?.total),
        referralClaimsLocked: num(c?.locked),
        grantsFounding: num(g?.founding),
        grantsComplimentary: num(g?.complimentary),
        grantsPending: num(g?.pending),
        grantsApplied: num(g?.applied),
        contributionMinor: num(g?.contributionMinor),
      };
    });
  }

  /**
   * Registrations in the plan window, from ALL sources.
   *
   * `registration_completed` has no channel and never will from this event —
   * it is emitted server-side at sign-up, after every scrap of campaign
   * context is gone. Returned undivided and labelled as such wherever it
   * renders, because attributing it to a channel would be a fabrication.
   */
  async registrationsInWindow(window: PlanWindow): Promise<number> {
    const db = getDb();
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.eventName, "registration_completed"),
          gte(analyticsEvents.occurredAt, window.from),
          lt(analyticsEvents.occurredAt, window.to),
        ),
      );
    return num(row?.n);
  }
}

/**
 * The window a plan's derived numbers are read over: `starts_on` (or the plan's
 * creation date when it has none) up to and including `ends_on` (or today).
 * `to` is exclusive, so the end date's own rows are counted.
 *
 * The start is CLAMPED to the end. Without a `starts_on` the start falls back
 * to the creation date, and the table's CHECK does not compare `ends_on` to
 * that — so recording a campaign that has already run (start left blank, end
 * in the past) produced `from` AFTER `to`. Every window-scoped query is
 * `>= from AND < to`, so all of them matched nothing and the whole panel read
 * zero, over a header saying "6 Sep 2026 to 1 Sep 2026". A back-dated plan
 * should show the day it covers, not silent zeroes.
 */
export function planWindow(plan: MarketingPlan, now = new Date()): PlanWindow {
  const utcDay = (at: Date) =>
    new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const endDay = plan.endsOn
    ? new Date(`${plan.endsOn}T00:00:00.000Z`)
    : utcDay(now);
  const from = plan.startsOn
    ? new Date(`${plan.startsOn}T00:00:00.000Z`)
    : new Date(Math.min(utcDay(plan.createdAt).getTime(), endDay.getTime()));
  const to = new Date(endDay.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

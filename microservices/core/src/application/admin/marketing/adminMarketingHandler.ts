import Elysia, { t } from "elysia";
import { adminGuard } from "../_adminGuard";
import { getUser } from "@persistence/api-utils/auth/supabaseAuth";
import { getDb } from "@persistence/db/client";
import { AdminAuditRepository } from "../../repositories/adminAuditRepository";
import { ReferralRepository } from "../../repositories/referralRepository";
import {
  MarketingPlanRepository,
  planWindow,
} from "../../repositories/marketingPlanRepository";
import { isUniqueViolation } from "../../stripe/pgErrors";
import { normalizeReferralCode } from "../../referrals/referralCode";
import { ADMIN_CAMPAIGN_SLUGS, isKnownCampaignSlug } from "./campaignSlugs";

/**
 * `/admin/marketing/*` — marketing plans, their channels, linked referral
 * codes, the App Store Connect offer mirror, hand-entered numbers, and the
 * attribution derived from all of it (MARKETING-PLANS § WP5).
 *
 * Every route is behind `adminGuard` and every mutation writes an
 * `admin_audit_log` row in the SAME transaction as the change, the convention
 * the rest of `/admin` follows.
 *
 * Two things this deliberately does not do:
 *
 *  - **It never creates a referral or store-offer code.** Code words are
 *    Brad's, chosen in `/admin → Referral codes` and in App Store Connect. The
 *    link routes take an existing code's id (or, for a store offer, transcribe
 *    what ASC already shows) and nothing here generates or suggests one.
 *  - **It never calls the App Store Connect API.** The offer rows are a
 *    record of what was configured there: price, cap, expiry and eligibility
 *    live in ASC and can drift from these rows. An ASC integration is a named
 *    follow-up, not part of this slice.
 */

const PLAN_STATUS = t.Union([
  t.Literal("draft"),
  t.Literal("active"),
  t.Literal("paused"),
  t.Literal("complete"),
]);

/**
 * The rails a plan can run. `founding_access` is the discretionary grant lane
 * (no price); `store_offer` is the App Store offer-code lane (the only priced
 * one). Closed set — an unknown lane would render as an unlabelled chip and
 * mean nothing to the attribution below.
 */
const OFFER_LANES = ["founding_access", "store_offer"] as const;

const SLUG_ERROR = "Unknown campaign slug — add it to the marketing site first";

function parseLanes(lanes: string[] | undefined): string[] | null {
  if (lanes === undefined) return null;
  const unique = [...new Set(lanes)];
  return unique.every((lane) =>
    (OFFER_LANES as readonly string[]).includes(lane),
  )
    ? unique
    : null;
}

/** ISO `YYYY-MM-DD`, or null. `undefined` means "not supplied". */
function parseDay(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
    ? value
    : undefined;
}

const CHANNEL_BODY = t.Object({
  campaignSlug: t.String({ maxLength: 32 }),
  label: t.String({ minLength: 1, maxLength: 200 }),
  placement: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
  notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
});

const STORE_OFFER_BODY = t.Object({
  platform: t.Union([t.Literal("ios"), t.Literal("android")]),
  code: t.String({ minLength: 3, maxLength: 64 }),
  tierName: t.String({ minLength: 1, maxLength: 64 }),
  durationMonths: t.Union([
    t.Literal(1),
    t.Literal(2),
    t.Literal(3),
    t.Literal(6),
    t.Literal(12),
  ]),
  priceMinor: t.Integer({ minimum: 0 }),
  currency: t.Optional(t.String({ pattern: "^[A-Za-z]{3}$" })),
  maxRedemptions: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
  expiresOn: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
  campaignSlug: t.Optional(t.Nullable(t.String({ maxLength: 32 }))),
  redemptionUrl: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
});

const UUID = t.String({ format: "uuid" });

const DAY_MS = 86_400_000;

/** A `Date` as the plain calendar day it falls on in UTC. */
const toIsoDay = (at: Date): string => at.toISOString().slice(0, 10);

/**
 * The PATCH body as an audit `after`, minus the brief's TEXT.
 *
 * `briefMd` runs to 64 KB, and a before/after pair of two 64 KB blobs is not
 * something anyone can read as a diff — it just makes `admin_audit_log` rows
 * enormous. The row records that the brief changed, and to what length, which
 * is what an audit trail is actually asked afterwards.
 */
function auditAfter<T extends { briefMd?: string | null }>(body: T) {
  // `null` is the brief being CLEARED, which is worth recording verbatim; only
  // a new body of text is replaced by its marker.
  if (typeof body.briefMd !== "string") return { ...body };
  return { ...body, briefMd: `<${body.briefMd.length} chars>` };
}

export const adminMarketingHandler = new Elysia()
  .use(adminGuard)

  // ─── The slugs the marketing site knows ─────────────────────────────────
  .get("/admin/marketing/campaign-slugs", () => ({
    data: { slugs: ADMIN_CAMPAIGN_SLUGS },
  }))

  // ─── Plans ──────────────────────────────────────────────────────────────
  .get(
    "/admin/marketing/plans",
    async ({ query }) => ({
      data: await new MarketingPlanRepository().listPlans({
        status: query.status,
      }),
    }),
    { query: t.Object({ status: t.Optional(PLAN_STATUS) }) },
  )
  .post(
    "/admin/marketing/plans",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const slug = ctx.body.slug.trim().toLowerCase();
      if (!/^[a-z0-9-]{3,48}$/.test(slug)) {
        ctx.set.status = 400;
        return {
          message: "Slug must be 3–48 lower-case letters, digits or hyphens",
        };
      }
      const lanes = parseLanes(ctx.body.offerLanes ?? []);
      if (lanes === null) {
        ctx.set.status = 400;
        return { message: "Unknown offer lane" };
      }
      const startsOn = parseDay(ctx.body.startsOn);
      const endsOn = parseDay(ctx.body.endsOn);
      if (startsOn === undefined && ctx.body.startsOn) {
        ctx.set.status = 400;
        return { message: "startsOn is not a valid date" };
      }
      if (endsOn === undefined && ctx.body.endsOn) {
        ctx.set.status = 400;
        return { message: "endsOn is not a valid date" };
      }
      if (startsOn && endsOn && endsOn < startsOn) {
        ctx.set.status = 400;
        return { message: "endsOn cannot be before startsOn" };
      }
      const repo = new MarketingPlanRepository();
      try {
        const created = await getDb().transaction(async (tx) => {
          const plan = await repo.createPlanIn(tx, {
            name: ctx.body.name.trim(),
            slug,
            objective: ctx.body.objective?.trim() || null,
            hypothesis: ctx.body.hypothesis?.trim() || null,
            decisionRule: ctx.body.decisionRule?.trim() || null,
            offerLanes: lanes,
            budgetCapMinor: ctx.body.budgetCapMinor ?? null,
            currency: ctx.body.currency ?? "GBP",
            startsOn: startsOn ?? null,
            endsOn: endsOn ?? null,
            briefMd: ctx.body.briefMd ?? null,
            createdBy: actorId,
          });
          await new AdminAuditRepository().record(
            {
              actorId,
              action: "marketing_plan.create",
              entityType: "marketing_plan",
              entityId: plan.id,
              after: { name: plan.name, slug: plan.slug, offerLanes: lanes },
            },
            tx,
          );
          return plan;
        });
        ctx.set.status = 201;
        return { data: created };
      } catch (err) {
        if (isUniqueViolation(err)) {
          ctx.set.status = 409;
          return { message: "A plan with that slug already exists" };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 200 }),
        slug: t.String({ minLength: 1, maxLength: 48 }),
        objective: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        hypothesis: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        decisionRule: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        offerLanes: t.Optional(
          t.Array(t.String({ maxLength: 40 }), { maxItems: 8 }),
        ),
        budgetCapMinor: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
        currency: t.Optional(t.String({ pattern: "^[A-Za-z]{3}$" })),
        startsOn: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
        endsOn: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
        // 64 KB, matching the column CHECK — a longer brief is a paste
        // accident, and the constraint would reject it as an opaque 500.
        briefMd: t.Optional(t.Nullable(t.String({ maxLength: 65536 }))),
      }),
    },
  )
  .patch(
    "/admin/marketing/plans/:id",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const lanes = parseLanes(ctx.body.offerLanes);
      if (ctx.body.offerLanes !== undefined && lanes === null) {
        ctx.set.status = 400;
        return { message: "Unknown offer lane" };
      }
      const startsOn = parseDay(ctx.body.startsOn);
      const endsOn = parseDay(ctx.body.endsOn);
      if (startsOn === undefined && ctx.body.startsOn) {
        ctx.set.status = 400;
        return { message: "startsOn is not a valid date" };
      }
      if (endsOn === undefined && ctx.body.endsOn) {
        ctx.set.status = 400;
        return { message: "endsOn is not a valid date" };
      }
      const repo = new MarketingPlanRepository();
      const result = await getDb().transaction(async (tx) => {
        const before = await repo.findPlanForUpdate(tx, ctx.params.id);
        if (!before) return null;
        const nextStart = startsOn === undefined ? before.startsOn : startsOn;
        const nextEnd = endsOn === undefined ? before.endsOn : endsOn;
        if (nextStart && nextEnd && nextEnd < nextStart)
          return "bad_dates" as const;
        const updated = await repo.updatePlanIn(tx, ctx.params.id, {
          name: ctx.body.name?.trim(),
          status: ctx.body.status,
          objective:
            ctx.body.objective === undefined
              ? undefined
              : ctx.body.objective?.trim() || null,
          hypothesis:
            ctx.body.hypothesis === undefined
              ? undefined
              : ctx.body.hypothesis?.trim() || null,
          decisionRule:
            ctx.body.decisionRule === undefined
              ? undefined
              : ctx.body.decisionRule?.trim() || null,
          ...(lanes !== null ? { offerLanes: lanes } : {}),
          budgetCapMinor: ctx.body.budgetCapMinor,
          currency: ctx.body.currency,
          startsOn: startsOn === undefined ? undefined : startsOn,
          endsOn: endsOn === undefined ? undefined : endsOn,
          briefMd:
            ctx.body.briefMd === undefined ? undefined : ctx.body.briefMd,
        });
        // A status change is the decision worth being able to reconstruct
        // later ("when did we pause this?"), so it gets its own action.
        const statusChanged =
          ctx.body.status !== undefined && ctx.body.status !== before.status;
        await new AdminAuditRepository().record(
          {
            actorId,
            action: statusChanged
              ? "marketing_plan.status"
              : "marketing_plan.update",
            entityType: "marketing_plan",
            entityId: ctx.params.id,
            before: statusChanged
              ? { status: before.status }
              : {
                  name: before.name,
                  offerLanes: before.offerLanes,
                  budgetCapMinor: before.budgetCapMinor,
                  startsOn: before.startsOn,
                  endsOn: before.endsOn,
                },
            after: statusChanged
              ? { status: ctx.body.status }
              : auditAfter(ctx.body),
          },
          tx,
        );
        return updated;
      });
      if (result === null) {
        ctx.set.status = 404;
        return { message: "Not found" };
      }
      if (result === "bad_dates") {
        ctx.set.status = 400;
        return { message: "endsOn cannot be before startsOn" };
      }
      return { data: result };
    },
    {
      params: t.Object({ id: UUID }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        status: t.Optional(PLAN_STATUS),
        objective: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        hypothesis: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        decisionRule: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        offerLanes: t.Optional(
          t.Array(t.String({ maxLength: 40 }), { maxItems: 8 }),
        ),
        budgetCapMinor: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
        currency: t.Optional(t.String({ pattern: "^[A-Za-z]{3}$" })),
        startsOn: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
        endsOn: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
        briefMd: t.Optional(t.Nullable(t.String({ maxLength: 65536 }))),
      }),
    },
  )

  // ─── Plan detail + derived attribution ──────────────────────────────────
  .get(
    "/admin/marketing/plans/:id",
    async (ctx) => {
      const repo = new MarketingPlanRepository();
      const plan = await repo.findPlan(ctx.params.id);
      if (!plan) {
        ctx.set.status = 404;
        return { message: "Not found" };
      }
      const window = planWindow(plan);
      const [channels, codes, storeOffers, metrics] = await Promise.all([
        repo.listChannels(plan.id),
        repo.listLinkedCodes(plan.id),
        repo.listStoreOffers(plan.id),
        repo.listMetrics(plan.id),
      ]);
      const [channelClicks, codeAttribution, registrations] = await Promise.all(
        [
          repo.storeClicksByChannel(
            channels.map((c) => c.campaignSlug),
            codes.map((c) => c.code),
            window,
          ),
          repo.attributionByCode(
            codes.map((c) => c.codeId),
            window,
          ),
          repo.registrationsInWindow(window),
        ],
      );
      return {
        data: {
          plan,
          channels,
          codes,
          storeOffers,
          metrics,
          attribution: {
            window: {
              // Plain calendar days (`YYYY-MM-DD`), NOT instants. The bounds
              // come from DATE columns, and an instant is re-read in the
              // viewer's own zone: `…-12T23:59:59.999Z` renders as "13 Sep"
              // anywhere east of UTC, which is exactly the off-by-one the
              // `to` bound is computed to avoid.
              from: toIsoDay(window.from),
              // The last day INCLUDED, not the exclusive bound the queries
              // use — an admin reading "to 13 Sep" for a plan ending on the
              // 12th would reasonably think a day had been double-counted.
              to: toIsoDay(new Date(window.to.getTime() - DAY_MS)),
            },
            channels: channelClicks,
            codes: codeAttribution,
            /**
             * NOT attributed to any channel, and labelled "all sources"
             * wherever it renders: `registration_completed` is emitted
             * server-side at sign-up, with no campaign context left to carry.
             */
            registrationsAllSources: registrations,
          },
        },
      };
    },
    { params: t.Object({ id: UUID }) },
  )

  // ─── Channels ───────────────────────────────────────────────────────────
  .post(
    "/admin/marketing/plans/:id/channels",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const slug = ctx.body.campaignSlug.trim().toLowerCase();
      if (!isKnownCampaignSlug(slug)) {
        ctx.set.status = 400;
        return { message: SLUG_ERROR };
      }
      const repo = new MarketingPlanRepository();
      try {
        const created = await getDb().transaction(async (tx) => {
          const plan = await repo.findPlanForUpdate(tx, ctx.params.id);
          if (!plan) return null;
          const channel = await repo.addChannelIn(tx, plan.id, {
            campaignSlug: slug,
            label: ctx.body.label.trim(),
            placement: ctx.body.placement?.trim() || null,
            notes: ctx.body.notes?.trim() || null,
          });
          await new AdminAuditRepository().record(
            {
              actorId,
              action: "marketing_plan_channel.add",
              entityType: "marketing_plan",
              entityId: plan.id,
              after: { channelId: channel.id, campaignSlug: slug },
            },
            tx,
          );
          return channel;
        });
        if (!created) {
          ctx.set.status = 404;
          return { message: "Not found" };
        }
        ctx.set.status = 201;
        return { data: created };
      } catch (err) {
        if (isUniqueViolation(err)) {
          ctx.set.status = 409;
          return { message: "That channel is already on this plan" };
        }
        throw err;
      }
    },
    { params: t.Object({ id: UUID }), body: CHANNEL_BODY },
  )
  .delete(
    "/admin/marketing/plans/:id/channels/:channelId",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const repo = new MarketingPlanRepository();
      const removed = await getDb().transaction(async (tx) => {
        const channel = await repo.removeChannelIn(
          tx,
          ctx.params.id,
          ctx.params.channelId,
        );
        if (!channel) return null;
        await new AdminAuditRepository().record(
          {
            actorId,
            action: "marketing_plan_channel.remove",
            entityType: "marketing_plan",
            entityId: ctx.params.id,
            before: {
              channelId: channel.id,
              campaignSlug: channel.campaignSlug,
            },
          },
          tx,
        );
        return channel;
      });
      if (!removed) {
        ctx.set.status = 404;
        return { message: "Not found" };
      }
      return { data: { id: removed.id, removed: true } };
    },
    { params: t.Object({ id: UUID, channelId: UUID }) },
  )

  // ─── Linked referral codes ──────────────────────────────────────────────
  .post(
    "/admin/marketing/plans/:id/codes",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const slug =
        ctx.body.campaignSlug === undefined || ctx.body.campaignSlug === null
          ? null
          : ctx.body.campaignSlug.trim().toLowerCase();
      if (slug !== null && !isKnownCampaignSlug(slug)) {
        ctx.set.status = 400;
        return { message: SLUG_ERROR };
      }
      // Accept the code's id or the code word itself — Brad reads the word off
      // a partner's flyer, not a UUID. Either way it must ALREADY exist:
      // nothing here creates a code.
      const referrals = new ReferralRepository();
      const existing = ctx.body.referralCodeId
        ? await referrals.findCodeById(ctx.body.referralCodeId)
        : ctx.body.code
          ? await referrals.findCodeByCanonical(
              normalizeReferralCode(ctx.body.code),
            )
          : null;
      if (!existing) {
        ctx.set.status = 404;
        return { message: "No such referral code — create it first" };
      }
      const repo = new MarketingPlanRepository();
      try {
        const linked = await getDb().transaction(async (tx) => {
          const plan = await repo.findPlanForUpdate(tx, ctx.params.id);
          if (!plan) return null;
          const link = await repo.linkCodeIn(tx, plan.id, existing.id, slug);
          await new AdminAuditRepository().record(
            {
              actorId,
              action: "marketing_plan_code.link",
              entityType: "marketing_plan",
              entityId: plan.id,
              after: {
                linkId: link.id,
                referralCodeId: existing.id,
                code: existing.code,
                campaignSlug: slug,
              },
            },
            tx,
          );
          return link;
        });
        if (!linked) {
          ctx.set.status = 404;
          return { message: "Not found" };
        }
        ctx.set.status = 201;
        return { data: { id: linked.id, code: existing.code } };
      } catch (err) {
        if (isUniqueViolation(err)) {
          ctx.set.status = 409;
          return { message: "That code is already linked to this plan" };
        }
        throw err;
      }
    },
    {
      params: t.Object({ id: UUID }),
      body: t.Object({
        referralCodeId: t.Optional(UUID),
        code: t.Optional(t.String({ maxLength: 64 })),
        campaignSlug: t.Optional(t.Nullable(t.String({ maxLength: 32 }))),
      }),
    },
  )
  .delete(
    "/admin/marketing/plans/:id/codes/:linkId",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const repo = new MarketingPlanRepository();
      const removed = await getDb().transaction(async (tx) => {
        const link = await repo.unlinkCodeIn(
          tx,
          ctx.params.id,
          ctx.params.linkId,
        );
        if (!link) return null;
        await new AdminAuditRepository().record(
          {
            actorId,
            action: "marketing_plan_code.unlink",
            entityType: "marketing_plan",
            entityId: ctx.params.id,
            before: { linkId: link.id, referralCodeId: link.referralCodeId },
          },
          tx,
        );
        return link;
      });
      if (!removed) {
        ctx.set.status = 404;
        return { message: "Not found" };
      }
      return { data: { id: removed.id, removed: true } };
    },
    { params: t.Object({ id: UUID, linkId: UUID }) },
  )

  // ─── Store offers (record, not control) ─────────────────────────────────
  .post(
    "/admin/marketing/plans/:id/store-offers",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const code = ctx.body.code.trim().toUpperCase();
      if (!/^[A-Z0-9]{3,64}$/.test(code)) {
        ctx.set.status = 400;
        return { message: "Offer codes are 3–64 letters or digits" };
      }
      const slug = ctx.body.campaignSlug?.trim().toLowerCase() || null;
      if (slug !== null && !isKnownCampaignSlug(slug)) {
        ctx.set.status = 400;
        return { message: SLUG_ERROR };
      }
      const expiresOn = parseDay(ctx.body.expiresOn);
      if (expiresOn === undefined && ctx.body.expiresOn) {
        ctx.set.status = 400;
        return { message: "expiresOn is not a valid date" };
      }
      const repo = new MarketingPlanRepository();
      try {
        const created = await getDb().transaction(async (tx) => {
          const plan = await repo.findPlanForUpdate(tx, ctx.params.id);
          if (!plan) return null;
          const offer = await repo.addStoreOfferIn(tx, plan.id, {
            platform: ctx.body.platform,
            code,
            tierName: ctx.body.tierName,
            durationMonths: ctx.body.durationMonths,
            priceMinor: ctx.body.priceMinor,
            currency: ctx.body.currency ?? "GBP",
            maxRedemptions: ctx.body.maxRedemptions ?? null,
            expiresOn: expiresOn ?? null,
            campaignSlug: slug,
            redemptionUrl: ctx.body.redemptionUrl?.trim() || null,
            notes: ctx.body.notes?.trim() || null,
          });
          await new AdminAuditRepository().record(
            {
              actorId,
              action: "marketing_plan_store_offer.add",
              entityType: "marketing_plan",
              entityId: plan.id,
              after: {
                offerId: offer.id,
                platform: offer.platform,
                code: offer.code,
              },
            },
            tx,
          );
          return offer;
        });
        if (!created) {
          ctx.set.status = 404;
          return { message: "Not found" };
        }
        ctx.set.status = 201;
        return { data: created };
      } catch (err) {
        if (isUniqueViolation(err)) {
          ctx.set.status = 409;
          return {
            message: "That offer code is already recorded on this plan",
          };
        }
        throw err;
      }
    },
    { params: t.Object({ id: UUID }), body: STORE_OFFER_BODY },
  )
  .patch(
    "/admin/marketing/plans/:id/store-offers/:offerId",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const expiresOn = parseDay(ctx.body.expiresOn);
      if (expiresOn === undefined && ctx.body.expiresOn) {
        ctx.set.status = 400;
        return { message: "expiresOn is not a valid date" };
      }
      const slug =
        ctx.body.campaignSlug === undefined
          ? undefined
          : ctx.body.campaignSlug?.trim().toLowerCase() || null;
      if (slug !== undefined && slug !== null && !isKnownCampaignSlug(slug)) {
        ctx.set.status = 400;
        return { message: SLUG_ERROR };
      }
      const repo = new MarketingPlanRepository();
      const updated = await getDb().transaction(async (tx) => {
        const offer = await repo.updateStoreOfferIn(
          tx,
          ctx.params.id,
          ctx.params.offerId,
          {
            tierName: ctx.body.tierName,
            durationMonths: ctx.body.durationMonths,
            priceMinor: ctx.body.priceMinor,
            currency: ctx.body.currency,
            maxRedemptions: ctx.body.maxRedemptions,
            expiresOn: expiresOn === undefined ? undefined : expiresOn,
            ...(slug === undefined ? {} : { campaignSlug: slug }),
            redemptionUrl:
              ctx.body.redemptionUrl === undefined
                ? undefined
                : ctx.body.redemptionUrl?.trim() || null,
            notes:
              ctx.body.notes === undefined
                ? undefined
                : ctx.body.notes?.trim() || null,
          },
        );
        if (!offer) return null;
        await new AdminAuditRepository().record(
          {
            actorId,
            action: "marketing_plan_store_offer.update",
            entityType: "marketing_plan",
            entityId: ctx.params.id,
            after: { offerId: offer.id, ...ctx.body },
          },
          tx,
        );
        return offer;
      });
      if (!updated) {
        ctx.set.status = 404;
        return { message: "Not found" };
      }
      return { data: updated };
    },
    {
      params: t.Object({ id: UUID, offerId: UUID }),
      body: t.Object({
        tierName: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
        durationMonths: t.Optional(
          t.Union([
            t.Literal(1),
            t.Literal(2),
            t.Literal(3),
            t.Literal(6),
            t.Literal(12),
          ]),
        ),
        priceMinor: t.Optional(t.Integer({ minimum: 0 })),
        currency: t.Optional(t.String({ pattern: "^[A-Za-z]{3}$" })),
        maxRedemptions: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
        expiresOn: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
        campaignSlug: t.Optional(t.Nullable(t.String({ maxLength: 32 }))),
        redemptionUrl: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
      }),
    },
  )
  .delete(
    "/admin/marketing/plans/:id/store-offers/:offerId",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const repo = new MarketingPlanRepository();
      const removed = await getDb().transaction(async (tx) => {
        const offer = await repo.removeStoreOfferIn(
          tx,
          ctx.params.id,
          ctx.params.offerId,
        );
        if (!offer) return null;
        await new AdminAuditRepository().record(
          {
            actorId,
            action: "marketing_plan_store_offer.remove",
            entityType: "marketing_plan",
            entityId: ctx.params.id,
            before: { offerId: offer.id, code: offer.code },
          },
          tx,
        );
        return offer;
      });
      if (!removed) {
        ctx.set.status = 404;
        return { message: "Not found" };
      }
      return { data: { id: removed.id, removed: true } };
    },
    { params: t.Object({ id: UUID, offerId: UUID }) },
  )

  // ─── Hand-entered weekly numbers ────────────────────────────────────────
  .put(
    "/admin/marketing/plans/:id/metrics",
    async (ctx) => {
      const { sub: actorId } = getUser(ctx);
      const slug =
        ctx.body.campaignSlug === undefined || ctx.body.campaignSlug === null
          ? null
          : ctx.body.campaignSlug.trim().toLowerCase();
      if (slug !== null && !isKnownCampaignSlug(slug)) {
        ctx.set.status = 400;
        return { message: SLUG_ERROR };
      }
      const metricDate = parseDay(ctx.body.metricDate);
      if (!metricDate) {
        ctx.set.status = 400;
        return { message: "metricDate is not a valid date" };
      }
      const repo = new MarketingPlanRepository();
      const saved = await getDb().transaction(async (tx) => {
        const plan = await repo.findPlanForUpdate(tx, ctx.params.id);
        if (!plan) return null;
        const row = await repo.upsertMetricIn(tx, plan.id, {
          campaignSlug: slug,
          metricDate,
          spendMinor: ctx.body.spendMinor ?? null,
          impressions: ctx.body.impressions ?? null,
          clicks: ctx.body.clicks ?? null,
          landingViews: ctx.body.landingViews ?? null,
          storeRedemptions: ctx.body.storeRedemptions ?? null,
          notes: ctx.body.notes?.trim() || null,
          recordedBy: actorId,
        });
        await new AdminAuditRepository().record(
          {
            actorId,
            action: "marketing_plan_metric.upsert",
            entityType: "marketing_plan",
            entityId: plan.id,
            after: {
              metricId: row.id,
              campaignSlug: slug,
              metricDate,
              spendMinor: row.spendMinor,
            },
          },
          tx,
        );
        return row;
      });
      if (!saved) {
        ctx.set.status = 404;
        return { message: "Not found" };
      }
      return { data: saved };
    },
    {
      params: t.Object({ id: UUID }),
      body: t.Object({
        campaignSlug: t.Optional(t.Nullable(t.String({ maxLength: 32 }))),
        metricDate: t.String({ maxLength: 10 }),
        spendMinor: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
        impressions: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
        clicks: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
        landingViews: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
        storeRedemptions: t.Optional(t.Nullable(t.Integer({ minimum: 0 }))),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
      }),
    },
  );

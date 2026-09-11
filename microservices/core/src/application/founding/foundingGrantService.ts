import { randomUUID } from "node:crypto";
import { webOrigin as sharedWebOrigin } from "../../shared/webOrigin";
import { AdminAuditRepository } from "../repositories/adminAuditRepository";
import { SubscriptionRepository } from "../repositories/subscriptionRepository";
import {
  FoundingGrantRepository,
  type CreateGrantOutcome,
} from "../repositories/foundingGrantRepository";
import { ReferralRepository } from "../repositories/referralRepository";
import { RESEND_NOTIFICATION_TO, sendEmail } from "../leads/resendClient";
import {
  getAuthUserIdentity,
  type SupabaseAuthIdentity,
} from "../account/supabaseAdminClient";
import {
  normalizeReferralCode,
  isValidReferralCode,
} from "../referrals/referralCode";
import { buildFoundingInviteEmail } from "./foundingInviteEmail";
import {
  FOUNDING_OFFERS,
  isFoundingTier,
  type FoundingPaymentMethod,
  type FoundingTierName,
} from "./foundingOffer";

/**
 * Founding-grant orchestration (BACKEND_BRIEF § 5, extended for the
 * "take an email at the stand and invite them" flow):
 *
 *   admin creates grant ──► account exists?  ──yes──► subscription row now
 *                                   │                    + invite/"you're in" email
 *                                   └──no──► PENDING grant keyed by email
 *                                             + invite email
 *                                             … buyer signs up …
 *                                             first GET /subscriptions/me
 *                                             ──► applyPendingForUser() writes the row
 *
 * A referral code given at grant time records attribution but is not a paid
 * conversion and therefore remains unlocked until a native-store purchase.
 * A live native-store subscription always wins. Administrative grants wait
 * until it expires and never cancel or displace paid IAP access.
 */

export type GrantError =
  | { code: "invalid_tier" }
  | { code: "tier_missing" }
  | { code: "invalid_email" }
  | { code: "invalid_months" }
  | { code: "invalid_contribution" }
  | { code: "contribution_reference_required" }
  | { code: "user_not_found" }
  | { code: "account_pending_deletion" }
  | { code: "coach_demotion" }
  | {
      code: "active_store_subscription";
      subscription: { tierName: string; expiresAt: Date | null };
    }
  | { code: "invalid_referral_code" }
  | { code: "referral_locked_elsewhere" }
  | { code: "pool_full"; seats: { pool: string; used: number; cap: number } }
  | { code: "duplicate" };

export interface GrantRequest {
  email?: string;
  userId?: string;
  tierName: string;
  grantKind?: "founding" | "complimentary";
  months?: number;
  contributionAmountMinor?: number;
  contributionCurrency?: string;
  contributionMethod?: FoundingPaymentMethod | null;
  contributionReference?: string | null;
  contributedAt?: Date;
  referralCode?: string | null;
  notes?: string | null;
  allowRoleChange?: boolean;
  sendInvite?: boolean;
}

export interface GrantResult {
  grantId: string;
  status: "active" | "pending";
  email: string;
  userId: string | null;
  tierName: FoundingTierName;
  grantKind: "founding" | "complimentary";
  months: number;
  expiresAt: Date | null;
  invited: boolean;
  inviteError: string | null;
  seats: { pool: string; used: number; cap: number } | null;
  referral: { code: string; label: string } | null;
}

const CONSUMER_TIERS: ReadonlySet<string> = new Set([
  "premium",
  "premium_plus",
]);
const COACH_ROLES: ReadonlySet<string> = new Set([
  "personal_trainer",
  "physiotherapist",
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ReferralClaimRejected extends Error {
  readonly reason: "invalid" | "locked_elsewhere";

  constructor(reason: "invalid" | "locked_elsewhere") {
    super(reason);
    this.reason = reason;
  }
}

export class FoundingGrantService {
  // Plain field declarations, not constructor parameter properties — the web
  // package's tsconfig has `erasableSyntaxOnly` and type-checks this file
  // transitively (same constraint as `EntitlementError`).
  private readonly grants: FoundingGrantRepository;
  private readonly referrals: ReferralRepository;
  private readonly audit: AdminAuditRepository;
  private readonly subscriptions: SubscriptionRepository;
  private readonly mailer: typeof sendEmail;
  private readonly webOrigin: string;
  private readonly authUserLookup: (
    userId: string,
  ) => Promise<SupabaseAuthIdentity>;

  constructor(
    grants: FoundingGrantRepository = new FoundingGrantRepository(),
    referrals: ReferralRepository = new ReferralRepository(),
    audit: AdminAuditRepository = new AdminAuditRepository(),
    mailer: typeof sendEmail = sendEmail,
    // The SHARED definition, not a third copy. This one used `??`, so an
    // empty `WEB_ORIGIN` — which `infra/api.ts` really does set for an unset
    // optional var — passed straight through and made the invite email's
    // download link the relative `/qr/founding`: a dead link in an email.
    webOrigin: string = sharedWebOrigin(),
    authUserLookup: (
      userId: string,
    ) => Promise<SupabaseAuthIdentity> = getAuthUserIdentity,
    subscriptions: SubscriptionRepository = new SubscriptionRepository(),
  ) {
    this.grants = grants;
    this.referrals = referrals;
    this.audit = audit;
    this.mailer = mailer;
    this.webOrigin = webOrigin;
    this.authUserLookup = authUserLookup;
    this.subscriptions = subscriptions;
  }

  async grant(
    req: GrantRequest,
    actorId: string,
  ): Promise<
    { ok: true; result: GrantResult } | { ok: false; error: GrantError }
  > {
    if (!isFoundingTier(req.tierName))
      return { ok: false, error: { code: "invalid_tier" } };
    const tierName: FoundingTierName = req.tierName;
    const offer = FOUNDING_OFFERS[tierName];
    const grantKind = req.grantKind ?? "founding";
    const months = req.months ?? offer.months;
    if (!Number.isInteger(months) || (months ?? 0) < 1 || (months ?? 0) > 120) {
      return { ok: false, error: { code: "invalid_months" } };
    }
    const contributionAmountMinor = req.contributionAmountMinor ?? 0;
    const contributionMethod = req.contributionMethod ?? null;
    const contributionCurrency = (
      req.contributionCurrency ?? "GBP"
    ).toUpperCase();
    const paymentReference = req.contributionReference?.trim() || null;
    const contributedAt =
      req.contributedAt ??
      (contributionAmountMinor > 0 ? new Date() : undefined);
    if (
      !Number.isInteger(contributionAmountMinor) ||
      contributionAmountMinor < 0 ||
      !/^[A-Z]{3}$/.test(contributionCurrency) ||
      (contributionAmountMinor === 0 &&
        (contributionMethod !== null ||
          paymentReference !== null ||
          contributedAt)) ||
      (contributionAmountMinor > 0 && (!contributionMethod || !contributedAt))
    ) {
      return { ok: false, error: { code: "invalid_contribution" } };
    }
    if (
      (contributionMethod === "bank_transfer" ||
        contributionMethod === "stripe_link") &&
      !paymentReference
    ) {
      return { ok: false, error: { code: "contribution_reference_required" } };
    }
    if (!(await this.grants.tierExists(tierName))) {
      return { ok: false, error: { code: "tier_missing" } };
    }

    // Resolve the account (may not exist yet).
    let profile: {
      id: string;
      email: string | null;
      role: string | null;
      deletedAt: Date | null;
    } | null = null;
    if (req.userId) {
      profile = await this.grants.findProfileById(req.userId);
      if (!profile) return { ok: false, error: { code: "user_not_found" } };
    }
    const email = (profile?.email ?? req.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email))
      return { ok: false, error: { code: "invalid_email" } };
    if (!profile) profile = await this.grants.findProfileByEmail(email);

    if (profile?.deletedAt) {
      return { ok: false, error: { code: "account_pending_deletion" } };
    }

    if (profile) {
      const storeSubscription =
        await this.subscriptions.findLiveStoreSubscription(profile.id);
      if (storeSubscription) {
        return {
          ok: false,
          error: {
            code: "active_store_subscription",
            subscription: {
              tierName: storeSubscription.tierName,
              expiresAt: storeSubscription.expiresAt,
            },
          },
        };
      }
    }

    // Trigger hazard (STATE.md): a consumer tier on a coach account flips
    // profiles.role to 'user' via update_subscription_limits_trigger.
    if (
      profile &&
      CONSUMER_TIERS.has(tierName) &&
      COACH_ROLES.has(profile.role ?? "") &&
      !req.allowRoleChange
    ) {
      return { ok: false, error: { code: "coach_demotion" } };
    }

    // Referral code (optional) — validate before we take the seat.
    let referralCodeId: string | null = null;
    let referralOut: GrantResult["referral"] = null;
    if (req.referralCode && req.referralCode.trim().length > 0) {
      const canonical = normalizeReferralCode(req.referralCode);
      if (!isValidReferralCode(canonical)) {
        return { ok: false, error: { code: "invalid_referral_code" } };
      }
      const code = await this.referrals.findCodeByCanonical(canonical);
      if (!code) {
        return { ok: false, error: { code: "invalid_referral_code" } };
      }
      if (
        profile &&
        (await this.referrals.hasLockedOtherCode(profile.id, code.id))
      ) {
        return { ok: false, error: { code: "referral_locked_elsewhere" } };
      }
      referralCodeId = code.id;
      referralOut = { code: code.displayCode, label: code.label };
    }

    const grantId = randomUUID();
    let outcome: CreateGrantOutcome;
    try {
      outcome = await this.grants.create(
        {
          id: grantId,
          userId: profile?.id ?? null,
          email,
          tierName,
          months: months!,
          grantKind,
          amountMinor: contributionAmountMinor,
          currency: contributionCurrency,
          paymentMethod: contributionMethod,
          paymentReference,
          paidAt: contributedAt ?? null,
          referralCodeId,
          grantedBy: actorId,
          notes: req.notes ?? null,
        },
        offer.pool,
        async ({ transaction, grant }) => {
          if (referralCodeId) {
            if (profile) {
              const claim = await this.referrals.claim(
                {
                  userId: profile.id,
                  canonicalCode: normalizeReferralCode(req.referralCode ?? ""),
                  source: "admin",
                  createdBy: actorId,
                  capacityExclusionGrantId: grantId,
                },
                transaction,
              );
              if (claim.kind === "invalid") {
                throw new ReferralClaimRejected("invalid");
              }
              if (
                claim.kind === "locked" &&
                claim.applied.codeId !== referralCodeId
              ) {
                throw new ReferralClaimRejected("locked_elsewhere");
              }
            } else if (
              !(await this.referrals.isCodeEligibleForPendingGrant(
                referralCodeId,
                grantId,
                transaction,
              ))
            ) {
              throw new ReferralClaimRejected("invalid");
            }
          }

          await this.audit.record(
            {
              actorId,
              action: "founding_grant.create",
              entityType: "founding_grant",
              entityId: grantId,
              after: {
                email,
                userId: profile?.id ?? null,
                tierName,
                grantKind,
                months,
                contributionAmountMinor: grant.amountMinor,
                contributionMethod,
                contributionReference: paymentReference,
                referralCodeId,
                pending: !profile,
              },
            },
            transaction,
          );
        },
      );
    } catch (err) {
      if (err instanceof ReferralClaimRejected) {
        return {
          ok: false,
          error: {
            code:
              err.reason === "locked_elsewhere"
                ? "referral_locked_elsewhere"
                : "invalid_referral_code",
          },
        };
      }
      throw err;
    }
    if (outcome.kind === "pool_full") {
      return { ok: false, error: { code: "pool_full", seats: outcome.seats } };
    }
    if (outcome.kind === "active_store_subscription") {
      return {
        ok: false,
        error: {
          code: "active_store_subscription",
          subscription: outcome.subscription,
        },
      };
    }
    if (outcome.kind === "duplicate")
      return { ok: false, error: { code: "duplicate" } };

    let invited = false;
    let inviteError: string | null = null;
    if (req.sendInvite !== false) {
      const sent = await this.sendInvite({
        grantId,
        email,
        tierName,
        grantKind,
        months: months!,
        amountMinor: contributionAmountMinor,
        currency: contributionCurrency,
        purchaseSource:
          contributionMethod === "stripe_checkout"
            ? "web_checkout"
            : "admin_grant",
        expiresAt: outcome.subscriptionExpiresAt,
        hasAccount: profile !== null,
      });
      invited = sent.ok;
      inviteError = sent.ok ? null : sent.error;
    }

    return {
      ok: true,
      result: {
        grantId,
        status: profile ? "active" : "pending",
        email,
        userId: profile?.id ?? null,
        tierName,
        grantKind,
        months: months!,
        expiresAt: outcome.subscriptionExpiresAt,
        invited,
        inviteError,
        seats: outcome.seats,
        referral: referralOut,
      },
    };
  }

  /** Re-send the invite for an existing grant (admin action). */
  async resendInvite(
    grantId: string,
    actorId: string,
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        error: "not_found" | "revoked" | "send_failed";
        detail?: string;
      }
  > {
    const grant = await this.grants.findById(grantId);
    if (!grant) return { ok: false, error: "not_found" };
    if (grant.revokedAt) return { ok: false, error: "revoked" };
    const list = await this.grants.list({ limit: 1000 });
    const row = list.find((g) => g.id === grantId);
    const sent = await this.sendInvite(
      {
        grantId,
        email: grant.email,
        tierName: grant.tierName as FoundingTierName,
        grantKind: grant.grantKind as "founding" | "complimentary",
        months: grant.months,
        amountMinor: grant.amountMinor,
        currency: grant.currency,
        purchaseSource:
          grant.paymentMethod === "stripe_checkout"
            ? "web_checkout"
            : "admin_grant",
        expiresAt: row?.subscriptionExpiresAt ?? null,
        hasAccount: grant.userId !== null,
      },
      async (transaction) => {
        await this.audit.record(
          {
            actorId,
            action: "founding_grant.resend_invite",
            entityType: "founding_grant",
            entityId: grantId,
            after: { ok: true },
          },
          transaction,
        );
      },
    );
    if (!sent.ok) {
      try {
        await this.audit.record({
          actorId,
          action: "founding_grant.resend_invite",
          entityType: "founding_grant",
          entityId: grantId,
          after: { ok: false },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[founding] failed-resend audit failed for grant ${grantId}: ${message}`,
        );
      }
    }
    return sent.ok
      ? { ok: true }
      : { ok: false, error: "send_failed", detail: sent.error };
  }

  private async sendInvite(
    input: {
      grantId: string;
      email: string;
      tierName: FoundingTierName;
      grantKind: "founding" | "complimentary";
      months: number;
      amountMinor: number;
      currency: string;
      purchaseSource: "web_checkout" | "admin_grant";
      expiresAt: Date | null;
      hasAccount: boolean;
    },
    afterMarked?: Parameters<FoundingGrantRepository["markInvited"]>[1],
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const mail = buildFoundingInviteEmail({
        tierName: input.tierName,
        grantKind: input.grantKind,
        months: input.months,
        expiresAt: input.expiresAt,
        hasAccount: input.hasAccount,
        email: input.email,
        webOrigin: this.webOrigin,
        amountMinor: input.amountMinor,
        currency: input.currency,
        purchaseSource: input.purchaseSource,
      });
      await this.mailer({
        to: input.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        replyTo: RESEND_NOTIFICATION_TO,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[founding] invite email failed for grant ${input.grantId}: ${message}`,
      );
      return { ok: false, error: message };
    }

    // Delivery succeeded, so report that truth even if recording invited_at
    // fails. Treating a bookkeeping failure as a send failure invites an
    // immediate retry and can send the buyer a duplicate email.
    try {
      await this.grants.markInvited(input.grantId, afterMarked);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[founding] invite bookkeeping failed for grant ${input.grantId}: ${message}`,
      );
    }
    return { ok: true };
  }

  /**
   * Apply any PENDING grant for this (authenticated) user's email. Called from
   * `GET /subscriptions/me` on every read; cheap when nothing is pending (one
   * indexed lookup on lower(email)). Errors are logged, never thrown — a
   * founding hiccup must not break the subscription read.
   */
  async applyPendingForUser(
    userId: string,
    email: string | undefined,
  ): Promise<boolean> {
    if (!email) return false;
    try {
      const pending = await this.grants.findPendingByEmail(email);
      if (pending.length === 0) return false;
      const profile = await this.grants.findProfileById(userId);
      if (!profile || profile.deletedAt) {
        console.warn(
          `[founding] pending grant not applied: profile missing or pending deletion for user=${userId}`,
        );
        return false;
      }
      const identity = await this.authUserLookup(userId);
      if (
        identity.emailConfirmedAt === null ||
        identity.email?.trim().toLowerCase() !== email.trim().toLowerCase()
      ) {
        console.warn(
          `[founding] pending grant not applied: unconfirmed or mismatched auth email for user=${userId}`,
        );
        return false;
      }
      let appliedAny = false;
      for (const grant of pending) {
        const storeSubscription =
          await this.subscriptions.findLiveStoreSubscription(userId);
        if (storeSubscription) {
          await this.audit.recordOnce({
            actorId: grant.grantedBy,
            action: "founding_grant.apply_deferred",
            entityType: "founding_grant",
            entityId: grant.id,
            after: { userId, reason: "active_store_subscription" },
          });
          console.warn(
            `[founding] pending grant ${grant.id} deferred: active store subscription for user=${userId}`,
          );
          continue;
        }
        const res = await this.grants.applyPending(
          grant.id,
          userId,
          async ({ transaction, expiresAt }) => {
            let referralApplication:
              | "none"
              | "applied"
              | "unchanged"
              | "already_locked"
              | "locked_conflict"
              | "unavailable" = "none";
            if (grant.referralCodeId) {
              const code = await this.referrals.findCodeByIdIn(
                transaction,
                grant.referralCodeId,
              );
              if (!code) {
                // FK integrity normally makes this impossible. Access still
                // belongs to the buyer; expose the inconsistency for repair.
                referralApplication = "unavailable";
              } else {
                const claim = await this.referrals.claim(
                  {
                    userId,
                    canonicalCode: code.code,
                    source: "admin",
                    createdBy: grant.grantedBy,
                    reservedCodeId: grant.referralCodeId,
                  },
                  transaction,
                );
                if (claim.kind === "invalid") {
                  referralApplication = "unavailable";
                } else if (claim.kind === "locked") {
                  referralApplication =
                    claim.applied.codeId === grant.referralCodeId
                      ? "already_locked"
                      : "locked_conflict";
                } else {
                  referralApplication = claim.kind;
                }
              }
            }
            await this.audit.record(
              {
                actorId: grant.grantedBy,
                action: "founding_grant.apply_pending",
                entityType: "founding_grant",
                entityId: grant.id,
                after: {
                  userId,
                  tierName: grant.tierName,
                  expiresAt: expiresAt.toISOString(),
                  referralApplication,
                },
              },
              transaction,
            );
          },
        );
        if (res.storeSubscription) {
          await this.audit.recordOnce({
            actorId: grant.grantedBy,
            action: "founding_grant.apply_deferred",
            entityType: "founding_grant",
            entityId: grant.id,
            after: { userId, reason: "active_store_subscription" },
          });
          console.warn(
            `[founding] pending grant ${grant.id} deferred after transactional recheck: active store subscription for user=${userId}`,
          );
          continue;
        }
        if (!res.applied) continue;
        appliedAny = true;
      }
      return appliedAny;
    } catch (err) {
      console.error(
        `[founding] applyPendingForUser failed for ${userId}:`,
        err,
      );
      return false;
    }
  }

  async revoke(
    grantId: string,
    reason: string,
    actorId: string,
  ): Promise<
    { ok: true } | { ok: false; error: "not_found" | "already_revoked" }
  > {
    const existing = await this.grants.findById(grantId);
    if (!existing) return { ok: false, error: "not_found" };
    if (existing.revokedAt) return { ok: false, error: "already_revoked" };
    const revoked = await this.grants.revoke(
      grantId,
      reason,
      async (grant, transaction) => {
        await this.audit.record(
          {
            actorId,
            action: "founding_grant.revoke",
            entityType: "founding_grant",
            entityId: grantId,
            before: { revokedAt: null },
            after: { revokedAt: grant.revokedAt?.toISOString() ?? null },
            reason,
          },
          transaction,
        );
      },
    );
    if (!revoked) return { ok: false, error: "already_revoked" };
    return { ok: true };
  }

  async extend(
    grantId: string,
    additionalMonths: number,
    reason: string,
    actorId: string,
  ): Promise<
    | {
        ok: true;
        result: { id: string; months: number; expiresAt: Date | null };
      }
    | {
        ok: false;
        error:
          | "invalid_months"
          | "not_found"
          | "revoked"
          | "account_deleted"
          | "active_store_subscription";
      }
  > {
    if (
      !Number.isInteger(additionalMonths) ||
      additionalMonths < 1 ||
      additionalMonths > 120
    ) {
      return { ok: false, error: "invalid_months" };
    }
    const outcome = await this.grants.extend(
      grantId,
      additionalMonths,
      async (before, after, expiresAt, transaction) => {
        await this.audit.record(
          {
            actorId,
            action: "founding_grant.extend",
            entityType: "founding_grant",
            entityId: grantId,
            before: { months: before.months },
            after: {
              months: after.months,
              additionalMonths,
              expiresAt: expiresAt?.toISOString() ?? null,
            },
            reason,
          },
          transaction,
        );
      },
    );
    if (outcome.kind !== "extended") return { ok: false, error: outcome.kind };
    return {
      ok: true,
      result: {
        id: grantId,
        months: outcome.grant.months,
        expiresAt: outcome.expiresAt,
      },
    };
  }
}

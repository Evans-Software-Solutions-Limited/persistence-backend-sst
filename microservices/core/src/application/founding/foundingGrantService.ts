import { randomUUID } from "node:crypto";
import { AdminAuditRepository } from "../repositories/adminAuditRepository";
import {
  FoundingGrantRepository,
  type CreateGrantOutcome,
} from "../repositories/foundingGrantRepository";
import { ReferralRepository } from "../repositories/referralRepository";
import { RESEND_NOTIFICATION_TO, sendEmail } from "../leads/resendClient";
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
 *   admin records payment ──► account exists?  ──yes──► subscription row now
 *                                   │                    + invite/"you're in" email
 *                                   └──no──► PENDING grant keyed by email
 *                                             + invite email
 *                                             … buyer signs up …
 *                                             first GET /subscriptions/me
 *                                             ──► applyPendingForUser() writes the row
 *
 * A referral code given at grant time attaches (or replaces an unlocked)
 * attribution and locks it — the grant IS the paid conversion (BRIEF D5).
 */

export type GrantError =
  | { code: "invalid_tier" }
  | { code: "tier_missing" }
  | { code: "invalid_email" }
  | { code: "user_not_found" }
  | { code: "coach_demotion" }
  | { code: "invalid_referral_code" }
  | { code: "referral_locked_elsewhere" }
  | { code: "pool_full"; seats: { pool: string; used: number; cap: number } }
  | { code: "duplicate" };

export interface GrantRequest {
  email?: string;
  userId?: string;
  tierName: string;
  amountMinor?: number;
  currency?: string;
  paymentMethod: FoundingPaymentMethod;
  paymentReference?: string | null;
  paidAt?: Date;
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
  expiresAt: Date | null;
  invited: boolean;
  inviteError: string | null;
  seats: { pool: string; used: number; cap: number };
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
  private readonly mailer: typeof sendEmail;
  private readonly webOrigin: string;

  constructor(
    grants: FoundingGrantRepository = new FoundingGrantRepository(),
    referrals: ReferralRepository = new ReferralRepository(),
    audit: AdminAuditRepository = new AdminAuditRepository(),
    mailer: typeof sendEmail = sendEmail,
    webOrigin: string = process.env.WEB_ORIGIN ??
      "https://persistence.evans-software-solutions.com",
  ) {
    this.grants = grants;
    this.referrals = referrals;
    this.audit = audit;
    this.mailer = mailer;
    this.webOrigin = webOrigin;
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
    if (!(await this.grants.tierExists(tierName))) {
      return { ok: false, error: { code: "tier_missing" } };
    }

    // Resolve the account (may not exist yet).
    let profile: {
      id: string;
      email: string | null;
      role: string | null;
    } | null = null;
    if (req.userId) {
      profile = await this.grants.findProfileById(req.userId);
      if (!profile) return { ok: false, error: { code: "user_not_found" } };
    }
    const email = (profile?.email ?? req.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email))
      return { ok: false, error: { code: "invalid_email" } };
    if (!profile) profile = await this.grants.findProfileByEmail(email);

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

    const offer = FOUNDING_OFFERS[tierName];
    const grantId = randomUUID();
    let outcome: CreateGrantOutcome;
    try {
      outcome = await this.grants.create(
        {
          id: grantId,
          userId: profile?.id ?? null,
          email,
          tierName,
          months: offer.months,
          amountMinor: req.amountMinor ?? offer.priceMinor,
          currency: req.currency ?? "GBP",
          paymentMethod: req.paymentMethod,
          paymentReference: req.paymentReference ?? null,
          paidAt: req.paidAt ?? new Date(),
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
              await this.referrals.lock(profile.id, transaction);
            } else if (
              !(await this.referrals.isCodeEligibleForPendingGrant(
                referralCodeId,
                grantId,
                transaction,
              ))
            ) {
              throw new ReferralClaimRejected("invalid");
            }
          } else if (profile) {
            // A pre-existing unlocked attribution becomes final when this paid
            // grant is recorded, even if the admin did not re-enter its code.
            await this.referrals.lock(profile.id, transaction);
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
                amountMinor: grant.amountMinor,
                paymentMethod: req.paymentMethod,
                paymentReference: req.paymentReference ?? null,
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
    if (outcome.kind === "duplicate")
      return { ok: false, error: { code: "duplicate" } };

    let invited = false;
    let inviteError: string | null = null;
    if (req.sendInvite !== false) {
      const sent = await this.sendInvite({
        grantId,
        email,
        tierName,
        months: offer.months,
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
    const sent = await this.sendInvite({
      grantId,
      email: grant.email,
      tierName: grant.tierName as FoundingTierName,
      months: grant.months,
      expiresAt: row?.subscriptionExpiresAt ?? null,
      hasAccount: grant.userId !== null,
    });
    await this.audit.record({
      actorId,
      action: "founding_grant.resend_invite",
      entityType: "founding_grant",
      entityId: grantId,
      after: { ok: sent.ok },
    });
    return sent.ok
      ? { ok: true }
      : { ok: false, error: "send_failed", detail: sent.error };
  }

  private async sendInvite(input: {
    grantId: string;
    email: string;
    tierName: FoundingTierName;
    months: number;
    expiresAt: Date | null;
    hasAccount: boolean;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const mail = buildFoundingInviteEmail({
      tierName: input.tierName,
      months: input.months,
      expiresAt: input.expiresAt,
      hasAccount: input.hasAccount,
      email: input.email,
      webOrigin: this.webOrigin,
    });
    try {
      await this.mailer({
        to: input.email,
        subject: mail.subject,
        text: mail.text,
        replyTo: RESEND_NOTIFICATION_TO,
      });
      await this.grants.markInvited(input.grantId);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[founding] invite email failed for grant ${input.grantId}: ${message}`,
      );
      return { ok: false, error: message };
    }
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
      let appliedAny = false;
      for (const grant of pending) {
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
            if (referralApplication !== "locked_conflict") {
              await this.referrals.lock(userId, transaction);
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
}

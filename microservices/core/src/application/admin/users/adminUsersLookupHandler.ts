import Elysia, { t } from "elysia";
import { adminGuard } from "../_adminGuard";
import { FoundingGrantRepository } from "../../repositories/foundingGrantRepository";
import { ReferralRepository } from "../../repositories/referralRepository";
import { SubscriptionRepository } from "../../repositories/subscriptionRepository";

/**
 * GET /admin/users?email= — exact (case-insensitive) lookup. Deliberately not
 * a list/search endpoint: the admin panel never enumerates users. Returns the
 * subscription state, attribution and any founding grants so the grant form
 * can warn before acting (role → demotion hazard, existing live sub, etc.).
 */
export const adminUsersLookupHandler = new Elysia().use(adminGuard).get(
  "/admin/users",
  async (ctx) => {
    const email = ctx.query.email.trim().toLowerCase();
    const grants = new FoundingGrantRepository();
    const profile = await grants.findProfileByEmail(email);
    const pending = await grants.findPendingByEmail(email);
    if (!profile) {
      return {
        data: {
          account: null,
          pendingGrants: pending.map((g) => ({
            id: g.id,
            tierName: g.tierName,
            paidAt: g.paidAt,
            invitedAt: g.invitedAt,
          })),
        },
      };
    }
    const [subscription, attribution, userGrants] = await Promise.all([
      new SubscriptionRepository().findForUser(profile.id),
      new ReferralRepository().findAppliedForUser(profile.id),
      grants.listForUser(profile.id),
    ]);
    return {
      data: {
        account: {
          id: profile.id,
          email: profile.email,
          role: profile.role,
          subscription: subscription
            ? {
                ...subscription,
                fromStore:
                  subscription.externalSubscriptionId?.startsWith("rc_") ??
                  false,
              }
            : null,
          attribution,
          foundingGrants: userGrants,
        },
        pendingGrants: [],
      },
    };
  },
  { query: t.Object({ email: t.String({ minLength: 3, maxLength: 320 }) }) },
);

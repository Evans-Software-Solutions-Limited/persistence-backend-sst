import Elysia from "elysia";
import { adminGuard } from "../_adminGuard";
import { FoundingGrantRepository } from "../../repositories/foundingGrantRepository";
import { ReferralRepository } from "../../repositories/referralRepository";

/** GET /admin/summary — the dashboard's single read. */
export const adminSummaryHandler = new Elysia()
  .use(adminGuard)
  .get("/admin/summary", async () => {
    const grants = new FoundingGrantRepository();
    const referrals = new ReferralRepository();
    const [founding, codes, recent] = await Promise.all([
      grants.summary(),
      referrals.countCodes(),
      grants.list({ limit: 10 }),
    ]);
    return {
      data: {
        founding,
        referrals: {
          codes: codes.codes,
          claims: codes.claims,
          lockedClaims: codes.locked,
        },
        recentGrants: recent,
      },
    };
  });

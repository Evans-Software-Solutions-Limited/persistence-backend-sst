import Elysia from "elysia";
// Internal admin surface (FOUNDING-OFFER milestone, thin slice of spec-32
// Slice C). One sub-app, mounted from `subscriptionsRoutes` rather than the
// root chain in api.ts: a root `.use()` for it tripped TS2589 (the chain is at
// TS's type-instantiation ceiling — see subscriptionsRoutes/nutritionRoutes). Every handler here is behind
// `adminGuard` (JWT `app_metadata.admin === true`, BRIEF D4).
import { adminSummaryHandler } from "./admin/summary/adminSummaryHandler";
import { adminUsersLookupHandler } from "./admin/users/adminUsersLookupHandler";
import { adminReferralCodesHandler } from "./admin/referral-codes/adminReferralCodesHandler";
import { adminAttributionsHandler } from "./admin/attributions/adminAttributionsHandler";
import { adminFoundingGrantsHandler } from "./admin/founding-grants/adminFoundingGrantsHandler";
import { adminAuditLogHandler } from "./admin/audit/adminAuditLogHandler";
import { adminMarketingHandler } from "./admin/marketing/adminMarketingHandler";

export const adminRoutes = new Elysia()
  .use(adminSummaryHandler)
  .use(adminUsersLookupHandler)
  .use(adminReferralCodesHandler)
  .use(adminAttributionsHandler)
  .use(adminFoundingGrantsHandler)
  .use(adminAuditLogHandler)
  .use(adminMarketingHandler);

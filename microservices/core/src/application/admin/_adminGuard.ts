import Elysia from "elysia";
import {
  getAuthUser,
  requireAdmin,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * Shared prefix for every `/admin/*` handler: verify the Supabase JWT, then
 * require the `app_metadata.admin` claim (FOUNDING-OFFER BRIEF D4). Handlers
 * `.use(adminGuard)` so the guard is declared exactly once.
 */
export const adminGuard = new Elysia({ name: "admin-guard" })
  .derive({ as: "scoped" }, async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle({ as: "scoped" }, requireAdmin);

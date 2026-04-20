import Elysia, { t } from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * DELETE /exercises/:id — hard delete, owner-only.
 *
 * Spec: design.md § DELETE /exercises/:id · AC 7.5
 * - Non-owner → 404 (NOT 403) per AC 7.5 / AC 7.8 (no existence leak)
 * - Non-existent → 404
 * - Success → 204 No Content
 * - No soft-delete in M0 (no `deleted_at` column)
 */
export const exercisesDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ExerciseService)
  .delete(
    "/exercises/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;

      const success = await ctx.ExerciseRepository.delete(id, userId);

      if (!success) {
        ctx.set.status = 404;
        return { error: "Exercise not found" };
      }

      // HTTP 204 No Content requires an empty body (RFC 7230 § 3.3.2).
      // Elysia's default serializer returns 500 when asked to produce a
      // 204 from a status-only handler (it can't reconcile `null` / ""
      // into a valid empty body). A raw Response is the only reliable
      // way to emit a clean 204 through Elysia today.
      //
      // Trade-off: the raw Response bypasses afterHandle hooks. None
      // exist in this codebase today; if/when they're added, either
      // switch this endpoint to 200 + `{ success: true }` (matching the
      // goals / sets delete handlers) or push the lifecycle semantics
      // into Elysia itself. See SMOKE_TEST.md step 8 which pins the
      // 204 contract.
      return new Response(null, { status: 204 });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );

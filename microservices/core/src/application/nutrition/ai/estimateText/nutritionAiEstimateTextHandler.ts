import Elysia, { t } from "elysia";
import {
  estimateFromText,
  AiUnreadableError,
  AiUnavailableError,
} from "../../services/aiEstimation";
import {
  assertEntitlement,
  EntitlementError,
} from "../../../entitlement/assertEntitlement";
import { AiUsageLogService } from "../../../repositories/aiUsageLogService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

const ENDPOINT = "/nutrition/ai/estimate-text";

/**
 * POST /nutrition/ai/estimate-text — free-text meal description →
 * `AiEstimate` (Tier B, M9.5). See
 * specs/13-nutrition-tracking/design.md § Revised 2026-07-03.
 *
 * Order: auth → entitlement (`ai_access`) → adapter call → response.
 * `ai_usage_log` is written in a `finally` on every path (success or
 * failure) per cross-cuts § 4.2 — a usage-log write failure never fails
 * the user-facing response.
 */
export const nutritionAiEstimateTextHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(AiUsageLogService)
  .post(
    "/nutrition/ai/estimate-text",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const startedAt = Date.now();
      const requestSizeBytes = Buffer.byteLength(JSON.stringify(ctx.body));
      let responseSizeBytes: number | null = null;

      try {
        const verdict = await assertEntitlement(userId, "ai_access");
        if (!verdict.allowed) {
          throw new EntitlementError(verdict, "ai_access");
        }

        const { description } = ctx.body;
        const estimate = await estimateFromText({ description });

        const body = { data: estimate };
        responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
        return body;
      } catch (error) {
        if (error instanceof AiUnreadableError) {
          ctx.set.status = 422;
          const body = { error: "ai_unreadable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        if (error instanceof AiUnavailableError) {
          ctx.set.status = 503;
          const body = { error: "ai_unavailable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        throw error;
      } finally {
        try {
          await ctx.AiUsageLogRepository.record({
            userId,
            endpoint: ENDPOINT,
            requestSizeBytes,
            responseSizeBytes,
            ms: Date.now() - startedAt,
          });
        } catch (logError) {
          console.error(
            `[ai-usage-log] failed to record ${ENDPOINT}: ${
              logError instanceof Error ? logError.message : String(logError)
            }`,
          );
        }
      }
    },
    {
      body: t.Object({
        description: t.String({ minLength: 1, maxLength: 1000 }),
      }),
    },
  );

import Elysia, { t } from "elysia";
import { NutritionEntryService } from "../../../repositories/nutritionEntryService";
import { FoodService } from "../../../repositories/foodService";
import { RecipeService } from "../../../repositories/recipeService";
import { MealService } from "../../../repositories/mealService";
import { UserMealService } from "../../../repositories/userMealService";
import { isUuid } from "../../../repositories/userMealRepository";
import type { NutritionEntryDTO } from "../../../repositories/nutritionEntryRepository";
import { normaliseIdempotencyKey } from "../../../shared/idempotencyKey";
import {
  entryBodyFields,
  resolveEntryInput,
  type EntryError,
} from "../resolveEntryInput";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/** Enough for a whole plan (several meals × several foods) in one call. */
export const MAX_BATCH_ENTRIES = 50;

export type BatchEntryResult =
  | { clientRequestId: string; entry: NutritionEntryDTO }
  | {
      clientRequestId: string;
      error: EntryError | "invalid_client_request_id";
    };

/**
 * POST /nutrition/entries/batch — "Add meal / whole plan to today" (N1) and
 * Mealprint "Log all today" (N22). Design D, PER-109.
 *
 * Each entry is today's `POST /nutrition/entries` body plus a required
 * `clientRequestId` (and optional `sourcePlanId` / `sourcePlanMealId`).
 *
 * Offline contract: every entry is idempotent on ITS OWN key, in the same
 * `client_request_id` column the single create uses. There is deliberately no
 * batch-wide transaction — a batch that partly committed before the response
 * was lost is simply re-sent, and the committed entries come back as they are
 * while the rest are created.
 *
 * Results are per entry, in request order, and the call answers 200 even when
 * some entries fail (an unknown food, another user's `userMealId`): one bad
 * entry must not strand the good ones in the phone's sync queue. Only a body
 * that fails the schema is rejected as a whole.
 */
export const nutritionEntriesBatchHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionEntryService)
  .use(FoodService)
  .use(RecipeService)
  .use(MealService)
  .use(UserMealService)
  .post(
    "/nutrition/entries/batch",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const results: BatchEntryResult[] = [];

      // Sequential on purpose: two entries with the same key in one batch
      // resolve to one row, and the order of the log is the order sent.
      for (const body of ctx.body.entries) {
        const key = normaliseIdempotencyKey(body.clientRequestId);
        if (key === null) {
          results.push({
            clientRequestId: body.clientRequestId,
            error: "invalid_client_request_id",
          });
          continue;
        }

        const existing =
          await ctx.NutritionEntryRepository.getByClientRequestId(userId, key);
        if (existing) {
          results.push({ clientRequestId: key, entry: existing });
          continue;
        }

        const resolved = await resolveEntryInput(ctx, userId, {
          ...body,
          // Provenance only. A plan created offline still has a `local-…`
          // id; storing null beats a uuid cast error stranding the entry.
          sourcePlanId:
            body.sourcePlanId && isUuid(body.sourcePlanId)
              ? body.sourcePlanId
              : null,
          sourcePlanMealId:
            body.sourcePlanMealId && isUuid(body.sourcePlanMealId)
              ? body.sourcePlanMealId
              : null,
        });
        if (!resolved.ok) {
          results.push({ clientRequestId: key, error: resolved.error });
          continue;
        }

        const entry = await ctx.NutritionEntryRepository.create(userId, {
          ...resolved.input,
          clientRequestId: key,
        });
        results.push({ clientRequestId: key, entry });
      }

      return { data: { results } };
    },
    {
      body: t.Object({
        entries: t.Array(
          t.Object({
            ...entryBodyFields,
            clientRequestId: t.String({ minLength: 1, maxLength: 200 }),
            sourcePlanId: t.Optional(t.String()),
            sourcePlanMealId: t.Optional(t.String()),
          }),
          { minItems: 1, maxItems: MAX_BATCH_ENTRIES },
        ),
      }),
    },
  );

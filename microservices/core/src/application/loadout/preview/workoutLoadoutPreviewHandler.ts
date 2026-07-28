import Elysia, { t } from "elysia";
import { WorkoutService } from "../../repositories/workoutService";
import { ExerciseService } from "../../repositories/exerciseService";
import { SavedGymService } from "../../repositories/savedGymService";
import { AiUsageLogService } from "../../repositories/aiUsageLogService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  assertEntitlement,
  EntitlementError,
} from "../../entitlement/assertEntitlement";
import {
  AiUnavailableError,
  AiUnreadableError,
  PREFILL_ALLOWANCE_MS,
  ROUTE_TIMEOUT_MS,
} from "../../nutrition/services/aiBedrockClient";
import {
  assembleAdaptedPlan,
  partitionPlan,
  shortlistPerRow,
  unionShortlist,
} from "../engine/adaptWorkout";
import { LOADABLE_EQUIPMENT_NAMES } from "../engine/intensityMismatch";
import {
  MIN_USEFUL_GENERATION_MS,
  REMAP_TIMEOUT_MS,
  remapMaxTokens,
  selectSubstitutes,
} from "../engine/remapModel";
import type { RemapSelection } from "../engine/remapModel";
import type { AdaptedPlan } from "../engine/types";

const ENDPOINT = "/workouts/:id/loadout/preview";

/**
 * Daily per-user ceiling on model-backed re-maps (AC-10.2, T-1.9).
 *
 * **30/day, DECIDED by Brad 2026-07-27.** It was a placeholder while AC-10.2 was
 * open; it is now the agreed value, so do not treat it as provisional.
 *
 * The economics behind the call: E2 measured **$0.0057 per adaptation**. Three a
 * day is ~$0.51/user/month against £29.99, and 30/day fully consumed by an abuser
 * is ~$5.13/month — comfortable. So this is abuse control, not unit economics,
 * which is what argued for a generous number: the bad failure mode is a real
 * athlete hitting the cap mid-session, and 30 adaptations in one day is far beyond
 * plausible human use. It also matches `AI_TEXT_DAILY_LIMIT`, the other
 * Haiku-class endpoint.
 *
 * Fail-safe parse: a mis-set env var must not silently disable the guard, so
 * anything non-finite or non-positive falls back to the default (#156 pattern).
 */
const parsedRemapLimit = Number(process.env.AI_LOADOUT_REMAP_DAILY_LIMIT);
const AI_LOADOUT_REMAP_DAILY_LIMIT =
  Number.isFinite(parsedRemapLimit) && parsedRemapLimit > 0
    ? parsedRemapLimit
    : 30;

/**
 * POST /workouts/:id/loadout/preview — adapt a workout to the equipment the
 * caller has today, and PERSIST NOTHING (spec-21 § 7, AC-3.5).
 *
 * The engine is the hybrid D7 selected by measurement (design § 6.0): a
 * deterministic § 6.2 shortlist (top 25/row) narrows the pool, a model chooses
 * from that shortlist and writes the per-row reason, and every deterministic
 * guard is re-applied afterwards. `engine/adaptWorkout.ts` documents the stages;
 * this handler owns auth, the entitlement, the ceiling, the usage log and the
 * status codes.
 *
 * ## Guard order (deliberate)
 *
 *   1. input validation (exactly one equipment source) → 400
 *   2. parent readable                                 → 404
 *   3. parent is not itself a variation                → 400
 *   4. `loadout` entitlement                           → 402
 *   5. equipment context resolves (gym ownership, known ids, non-empty) → 400
 *   6. partition the plan
 *   7. **daily ceiling, only if a model call is actually needed** → 429
 *   8. candidate assembly → shortlist → model → verify
 *
 * Parent-read before entitlement so a caller poking at a workout they cannot see
 * gets 404 and learns nothing — a 402 would confirm the workout exists. Matches
 * `POST /workouts/:id/variations` exactly.
 *
 * ⚠ **The ceiling sits AFTER the partition, and that ordering is the point.** A
 * plan whose kit covers every row needs no model call, costs nothing, and writes
 * no usage row — E2's `full_gym` context produced zero swaps across all 20 of its
 * fixtures, so this is the common case in a well-equipped gym, not an edge one.
 * Charging it against a daily cap would deny a free operation and make the cap
 * bite for no reason.
 *
 * ## No deterministic fallback when Bedrock is down
 *
 * A model failure is a 503, not a silent downgrade to the § 6.2 ranker. Shipping
 * ranker output under a Premium+ badge is precisely what the bake-off rejected: it
 * lost 4-50 on blind preference and produced equipment-legal but unshippable
 * swaps (Barbell Deadlift → Atlas Stones in a bands-only context). A visible
 * outage is a better product than a quietly worse plan. **Confirmed by Brad
 * 2026-07-27** — this is the agreed behaviour, not an open question.
 */
export const workoutLoadoutPreviewHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutService)
  .use(ExerciseService)
  .use(SavedGymService)
  .use(AiUsageLogService)
  .post(
    "/workouts/:id/loadout/preview",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const workoutId = ctx.params.id;
      const { savedGymId, equipmentTypeIds } = ctx.body;

      const startedAt = Date.now();
      const requestSizeBytes = Buffer.byteLength(JSON.stringify(ctx.body));
      let responseSizeBytes: number | null = null;
      // Usage rows record ACTUAL inferences (success, 422, 503) — never
      // pre-model rejections (400/402/404/429), which cost nothing and must not
      // consume the ceiling.
      let reachedModel = false;
      // Hoisted so the catch below can report it. `plan` is scoped to the try,
      // and the failure that most needs this number — a truncation 422 — is
      // thrown from inside `selectSubstitutes`, i.e. only ever seen out here.
      let swapRowCount = 0;

      try {
        // 1. Exactly one equipment source. Accepting both would mean silently
        //    preferring one, and the two collect paths (AC-2.1 saved gym vs
        //    AC-2.2/AC-2.3 manual or scanned ids) never produce both.
        const hasGym = savedGymId != null;
        const hasIds = equipmentTypeIds != null;
        if (hasGym === hasIds) {
          ctx.set.status = 400;
          return {
            code: "EQUIPMENT_CONTEXT_REQUIRED",
            message: "Provide exactly one of savedGymId or equipmentTypeIds",
          };
        }

        // 2. Parent readable — own, public, friends, or assigned (AC-1.2). Not
        //    owner-only: Loadout applies to a coach-assigned workout too.
        const parent = await ctx.WorkoutRepository.findReadableWorkout(
          workoutId,
          userId,
        );
        if (!parent) {
          ctx.set.status = 404;
          return { code: "not_found", message: "Workout not found" };
        }

        // 3. Adapting a variation would produce a variation-of-a-variation on
        //    save, which `POST /workouts/:id/variations` refuses and which no
        //    listing surface can reach. Refuse here too rather than letting the
        //    user build a plan they cannot keep.
        if (parent.parentWorkoutId != null) {
          ctx.set.status = 400;
          return {
            code: "PARENT_IS_A_VARIATION",
            message: "Adapt the original workout, not one of its saved setups",
            rootWorkoutId: parent.parentWorkoutId,
          };
        }

        // 4. Entitlement before any further validation or work, so an unentitled
        //    caller gets neither the feature nor free validation of their payload.
        const verdict = await assertEntitlement(userId, "loadout");
        if (!verdict.allowed) {
          throw new EntitlementError(verdict, "loadout");
        }

        // 5. Resolve the equipment context.
        let context: string[];
        if (hasGym) {
          const gym = await ctx.SavedGymRepository.getById(
            savedGymId as string,
            userId,
          );
          if (!gym) {
            // 400, not 404: the workout exists and is readable — it is the
            // supplied gym id that is unusable. Ownership is checked (not just
            // existence) because another user's gym would otherwise leak its kit
            // into this caller's adaptation.
            ctx.set.status = 400;
            return {
              code: "UNKNOWN_SAVED_GYM",
              message: "Saved gym not found",
            };
          }
          context = gym.equipmentTypeIds;
        } else {
          const ids = equipmentTypeIds as string[];
          const unknown =
            await ctx.SavedGymRepository.findUnknownEquipmentTypeIds(ids);
          if (unknown.length > 0) {
            ctx.set.status = 400;
            return {
              code: "UNKNOWN_EQUIPMENT_TYPE",
              message: "One or more equipment types do not exist",
              unknownEquipmentTypeIds: unknown,
            };
          }
          context = Array.from(new Set(ids));
        }

        if (context.length === 0) {
          // An empty context is rejected rather than treated as "bodyweight
          // only": every exercise needing equipment would be swapped or
          // unresolved, which is a plan nobody asked for. A saved gym saved with
          // no kit lands here too, which is the right answer for it.
          ctx.set.status = 400;
          return {
            code: "EMPTY_EQUIPMENT_CONTEXT",
            message: "The equipment context is empty",
          };
        }

        // 6. Partition. `listAdaptationRows` carries the ranking fields the wire
        //    shape does not.
        const parentRows =
          await ctx.WorkoutRepository.listAdaptationRows(workoutId);
        const plan = partitionPlan(parentRows, context);
        const needsSwap = plan.filter((row) => row.needsSwap);
        swapRowCount = needsSwap.length;

        const respond = (adapted: AdaptedPlan) => {
          const body = {
            data: {
              workoutId,
              parentName: parent.name,
              savedGymId: savedGymId ?? null,
              equipmentTypeIds: context,
              rows: adapted.rows,
              meta: adapted.meta,
            },
          };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        };

        const emptySelections = new Map<number, RemapSelection>();

        // Nothing to swap → no model call, no usage row, no ceiling consumed.
        if (needsSwap.length === 0) {
          return respond(
            assembleAdaptedPlan({
              plan,
              shortlistByRow: new Map(),
              selections: emptySelections,
              rankContext: { loggedExerciseIds: new Set() },
              equipmentTypeIds: context,
              loadableEquipmentTypeIds: new Set(),
              candidateCount: 0,
              candidatePoolTruncated: false,
              modelId: null,
            }),
          );
        }

        // 7. Daily ceiling. Best-effort under concurrency (counted rows are
        //    committed post-inference), which is fine for a cost backstop.
        const usedToday = await ctx.AiUsageLogRepository.countForUserToday(
          userId,
          ENDPOINT,
        );
        if (usedToday >= AI_LOADOUT_REMAP_DAILY_LIMIT) {
          ctx.set.status = 429;
          return { error: "ai_daily_limit" };
        }

        // 8. Stage 1 — one candidate query for the whole adaptation (§ 6.3).
        const muscleIds = Array.from(
          new Set(needsSwap.flatMap((row) => row.source.primaryMuscles)),
        );
        const { candidates, truncated } =
          await ctx.ExerciseRepository.listAdaptationCandidates(userId, {
            muscleIds,
            equipmentTypeIds: context,
            // Never offer an exercise the plan already contains.
            excludeExerciseIds: plan.map((row) => row.source.id),
          });

        if (truncated) {
          // Never silent (§ 6.3). Real behaviour at the catalogue's size — 28 of
          // E2's 80 pools hit the cap — and the shortlist makes it far less
          // consequential, but a pool that silently loses its tail is exactly the
          // kind of thing that gets diagnosed as "the model got worse".
          console.warn(
            `[loadout] candidate pool truncated at the cap for workout ${workoutId} (${muscleIds.length} muscles, ${context.length} equipment types)`,
          );
        }

        // The +8 "logged before" signal, intersected with the candidates rather
        // than fetched as the caller's whole history. Sequential rather than
        // concurrent with the query above (which § 6.3 notes it could be),
        // because the intersection needs the candidate ids and a bounded scan is
        // worth more than one saved round trip inside a request that already
        // makes a ~2.6 s model call.
        // All four reads are independent of each other. The two reference-table
        // reads join the batch rather than sitting on the critical path between
        // the shortlist and the model call: they are static data, and this request
        // already spends ~2.6 s in Bedrock inside a hard 30 s budget.
        const [loggedIds, loadableIds, muscleGroups, equipmentTypes] =
          await Promise.all([
            ctx.ExerciseRepository.listPreviouslyLoggedExerciseIds(
              userId,
              candidates.map((candidate) => candidate.id),
            ),
            ctx.ExerciseRepository.findEquipmentTypeIdsByName([
              ...LOADABLE_EQUIPMENT_NAMES,
            ]),
            ctx.ExerciseRepository.getMuscleGroups(),
            ctx.ExerciseRepository.getEquipmentTypes(),
          ]);

        if (loadableIds.length !== LOADABLE_EQUIPMENT_NAMES.length) {
          // A check that cannot fire is worse than no check, because it reads as a
          // pass — and the same is true of one that HALF fires. A single rename
          // (`Cable Machine` → `Cables`) would leave nine ids resolving, silently
          // reclassify every cable-loaded row as unloadable, and both invent
          // false `intensity_mismatch` flags and drop real ones. So the warning is
          // on the count, not on emptiness.
          console.warn(
            `[loadout] resolved ${loadableIds.length} of ${LOADABLE_EQUIPMENT_NAMES.length} loadable equipment types — intensity-mismatch detection (AC-3.5b) is degraded; check equipment_types names against LOADABLE_EQUIPMENT_NAMES`,
          );
        }

        const rankContext = { loggedExerciseIds: new Set(loggedIds) };
        const shortlistByRow = shortlistPerRow(plan, candidates, rankContext);
        const offered = unionShortlist(shortlistByRow);

        let selections = emptySelections as ReadonlyMap<number, RemapSelection>;
        let modelId: string | null = null;

        // Every row needing a swap came up empty in the ranker — there is nothing
        // to offer the model, so calling it would spend money to be told so.
        if (offered.length > 0) {
          const lookups = {
            muscleNames: new Map(
              muscleGroups.map((m) => [m.id, m.displayName ?? m.name]),
            ),
            equipmentNames: new Map(equipmentTypes.map((e) => [e.id, e.name])),
          };

          // ⚠ What is LEFT of the route budget, not the nominal 24 s. The seven
          // round trips above are assumed to cost ~3 s; on a cold start with a
          // fresh pooler connection they cost more, and a full-length attempt on
          // top of that overruns the 29 s Lambda — which produces no 503, no
          // usage row and no log line, i.e. this bug again in miniature.
          //
          // ⚠ `POST_MODEL_RESERVE_MS` covers MORE than the usage-log INSERT.
          // `startedAt` is set inside this handler, which is AFTER Elysia's
          // `.derive` has run `getAuthUser` — and on a cold instance that does a
          // `createRemoteJWKSet` fetch to Supabase plus a TLS handshake, ~0.5–1.5 s
          // that this clock never sees but the Lambda's 29 s does. The reserve
          // therefore absorbs the unmeasured auth leg AND the `finally`'s INSERT
          // on a fresh pooler connection, and both costs are correlated because
          // both are cold. 2 s did not cover that pair; 3.5 s does.
          const POST_MODEL_RESERVE_MS = 3_500;
          const remainingMs =
            ROUTE_TIMEOUT_MS - (Date.now() - startedAt) - POST_MODEL_RESERVE_MS;
          const attemptMs = Math.min(REMAP_TIMEOUT_MS, remainingMs);

          // ⚠ Logged BEFORE the call, and that ordering is the point. When this
          // surface failed on staging 2026-07-28 the Lambda was killed
          // mid-inference, so nothing after the call ever ran — CloudWatch held a
          // START and a REPORT 29 s apart and not one application line, and the
          // Sentry trace id appeared nowhere. Diagnosis needed API Gateway access
          // logs plus Bedrock metrics. This line says "we were in the model call"
          // outright. Counts and ids only; the prompt carries the user's workout.
          console.info(
            `[loadout-remap] start workout=${workoutId} swapRows=${needsSwap.length} candidates=${offered.length} attemptMs=${attemptMs} maxTokens=${remapMaxTokens(needsSwap.length, attemptMs)}`,
          );

          // ⚠ Fail BEFORE marking the request billable. A usage row means "an
          // inference reached the provider"; a preamble that ate the budget means
          // no request is sent at all, and charging a daily adaptation for that
          // punishes the user for our own slowness. This is the last pre-model
          // exit — every other one (400/402/404/429) already sits above
          // `reachedModel`.
          if (attemptMs < PREFILL_ALLOWANCE_MS + MIN_USEFUL_GENERATION_MS) {
            throw new AiUnavailableError(
              `ai_budget_exhausted: ${Math.max(0, attemptMs)}ms left after the preamble`,
            );
          }

          // Set LAST, immediately before the provider call. Anything that can
          // still fail before Bedrock is reached must not write a usage row, or a
          // DB blip silently burns one of the user's daily adaptations for an
          // inference that never happened.
          reachedModel = true;
          const result = await selectSubstitutes(
            {
              workoutName: parent.name,
              plan,
              candidates: offered,
              equipmentTypeIds: context,
              lookups,
            },
            { timeoutMs: attemptMs },
          );
          selections = result.selections;
          modelId = result.usage.modelId;
          // `outputTokens` against the ceiling is the number that predicts the
          // next timeout: generation is serial, so tokens ARE wall clock.
          console.info(
            `[loadout-remap] done workout=${workoutId} model=${result.usage.modelId} latencyMs=${result.usage.latencyMs} inputTokens=${result.usage.inputTokens} outputTokens=${result.usage.outputTokens} maxTokens=${remapMaxTokens(needsSwap.length, attemptMs)}`,
          );
        }

        return respond(
          assembleAdaptedPlan({
            plan,
            shortlistByRow,
            selections,
            rankContext,
            equipmentTypeIds: context,
            loadableEquipmentTypeIds: new Set(loadableIds),
            candidateCount: candidates.length,
            candidatePoolTruncated: truncated,
            modelId,
          }),
        );
      } catch (error) {
        // A non-member exercise id, a refusal or a malformed tool payload — all
        // parse failures (§ 1 rule 1), never a fabricated row.
        if (error instanceof AiUnreadableError) {
          // ⚠ Logged for the same reason as the 503 below, and arguably more
          // urgently: `selectSubstitutes` throws the truncation error BEFORE
          // returning, so the `[loadout-remap] done` line never fires and
          // nothing would record the row count or the ceiling that was hit.
          // After this change truncation is the expected failure for very long
          // plans (see `remapMaxTokens`), so it is the one that must arrive with
          // its numbers attached.
          console.error(
            `[loadout-remap] unreadable workout=${workoutId} swapRows=${swapRowCount}: ${error.message}`,
          );
          ctx.set.status = 422;
          const body = { error: "ai_unreadable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        if (error instanceof AiUnavailableError) {
          // Named, not swallowed. This is the branch that SHOULD have fired on
          // 2026-07-28 and could not, because the SDK's hidden retries pushed
          // the call past the Lambda timeout before it could throw.
          console.error(
            `[loadout-remap] unavailable workout=${workoutId} swapRows=${swapRowCount}: ${error.message}`,
          );
          ctx.set.status = 503;
          const body = { error: "ai_unavailable" };
          responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          return body;
        }
        throw error;
      } finally {
        try {
          if (reachedModel) {
            await ctx.AiUsageLogRepository.record({
              userId,
              endpoint: ENDPOINT,
              requestSizeBytes,
              responseSizeBytes,
              ms: Date.now() - startedAt,
            });
          }
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
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        savedGymId: t.Optional(
          t.Union([t.String({ format: "uuid" }), t.Null()]),
        ),
        // `t.Null()` for symmetry with `savedGymId`: sending both keys with the
        // unused one nulled is the natural client shape given the "exactly one
        // source" rule, and without it that request fails body validation with a
        // 422 dump instead of the documented `EQUIPMENT_CONTEXT_REQUIRED` 400.
        equipmentTypeIds: t.Optional(
          t.Union([t.Array(t.String({ format: "uuid" })), t.Null()]),
        ),
      }),
    },
  );

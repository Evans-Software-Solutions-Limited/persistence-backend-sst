import { AI_BUDGET_EXHAUSTED_BODY, hasAiBudget } from "../../ai/aiBudget";
import Elysia, { t } from "elysia";
import { eq } from "drizzle-orm";
import { profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { resolveCoachScope } from "../../relationships/resolveCoachScope";
import { auditClientDataRead } from "../../relationships/auditClientDataRead";
import {
  assertEntitlement,
  EntitlementError,
} from "../../entitlement/assertEntitlement";
import { AiUsageLogRepository } from "../../repositories/aiUsageLogRepository";
import {
  AI_COACH_SUMMARY_DAILY_LIMIT,
  AI_COACH_SUMMARY_ENDPOINT,
  ClientAiSummaryRepository,
  type ClientAiSummaryRow,
} from "../../repositories/clientAiSummaryRepository";
import {
  generateClientSummary,
  resolveSummaryModelId,
  ClientSummaryUnavailableError,
} from "../services/clientSummaryAi";
import {
  addDays,
  localDateIn,
  safeTimeZone,
} from "../../adherence/computeAdherence";
import type { AiSummaryModule } from "../../repositories/clientDetail";
import type { WeekOfProgramme } from "../../programs/scheduling";
import {
  availableAreas,
  firstSummaryOn,
  isFirstWeek,
  legacySummaryText,
  type SummaryAreaLine,
  type WeeklySummaryEvidence,
} from "../services/weeklySummary";
import { loadWeeklySummaryEvidence } from "../services/weeklySummaryEvidenceRepository";

/**
 * The route's `data` (design B D3/D4). Additive over the 1.2.0
 * `AiSummaryModule`: `summary` is still filled whenever a summary exists, so
 * old bundles keep showing a paragraph, and is null in the first week, which
 * they render as their empty state.
 */
export interface WeeklySummaryModule extends AiSummaryModule {
  state: "ready" | "firstWeek";
  /** Client-local date of the first summary; only in the first week. */
  firstSummaryOn?: string;
  /** null on rows cached before PER-115 and when there's no summary. */
  headline: string | null;
  areas: SummaryAreaLine[];
  ask: string | null;
  weekOfProgramme: WeekOfProgramme | null;
}

function readyModule(
  row: ClientAiSummaryRow,
  coversDate: string,
  canManualRefresh: boolean,
): WeeklySummaryModule {
  return {
    state: "ready",
    summary: row.summary,
    coversDate,
    generatedAt: row.generatedAt,
    canManualRefresh,
    headline: row.headline,
    areas: row.areas ?? [],
    ask: row.ask,
    weekOfProgramme: row.weekOfProgramme,
  };
}

/**
 * POST /trainers/me/clients/:clientId/ai-summary — generate (or return the
 * cached) coach AI Client Summary for the concluded client-local day
 * (specs/10-trainer-features/design.md § Module g, Phase 6). Body `{ manual? }`
 * — a single path for the lazy first generation and the one manual refresh.
 *
 * Gate/exec order (design.md § Module g endpoint, PER-115 design B D4):
 *   role → resolveCoachScope → assertEntitlement(ai_access) → FIRST WEEK →
 *   per-coach daily-ceiling → ROW-STATE → evidence → generate (Bedrock) →
 *   upsert → usage.
 *
 * First week (PER-115): until the Monday after the client's first complete
 * Monday-to-Sunday week of coaching, the route answers
 * `{ state: 'firstWeek', firstSummaryOn, summary: null }` with no AI call, no
 * quota counted and no data read.
 *
 * Row-state:
 *   - no row for covers_date            → generate (auto), insert refresh_count=0
 *   - row + manual=true + refresh_count<1 → regenerate, set refresh_count=1
 *   - else (manual false OR count ≥ 1)  → return CACHED, NO inference
 *
 * This is a WRITE that spends tokens but writes NO `trainer_actions_audit` row —
 * it is NOT a client-data mutation (nothing on the client's record changes),
 * only a per-coach cache is written. The privacy line holds: the evidence is
 * adherence counts, the programme week, form answers (no photos) and plan
 * meals logged — NEVER photos, private notes or the food-level entry log
 * (design B D4). Mounted as its own handler (a
 * sibling of the aggregate GET) to keep the root Elysia type instantiation
 * under TS's depth ceiling (TS2589).
 *
 * On any Bedrock failure, or output that fails the strict parse, the route
 * answers 503 { error: "ai_unavailable", facts } (the evidence it gathered)
 * with NO cache write and never invented text. Usage is recorded because the
 * model was reached.
 */
export const trainersMeGenerateClientAiSummaryHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/trainers/me/clients/:clientId/ai-summary",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };
      const manual =
        (ctx.body as { manual?: boolean } | undefined)?.manual === true;

      const startedAt = Date.now();
      let didInfer = false;
      let requestSizeBytes: number | null = null;
      let responseSizeBytes: number | null = null;
      let evidence: WeeklySummaryEvidence | null = null;

      const summaryRepo = new ClientAiSummaryRepository();
      const usageRepo = new AiUsageLogRepository();

      try {
        // 1. Role + active relationship (cross-cuts § 1.3, role FIRST), and
        // this coach's own relationship + settings (several coaches).
        const gate = await resolveCoachScope(trainerId, clientId);
        if (!gate.allowed) {
          ctx.set.status = gate.status;
          return gate.body;
        }
        const scope = gate.scope;

        // 2. Entitlement — the COACH's ai_access (trainer tiers carry it, M9.5).
        const entitlement = await assertEntitlement(trainerId, "ai_access");
        if (!entitlement.allowed) {
          throw new EntitlementError(entitlement, "ai_access");
        }

        // 4. covers_date = the CONCLUDED (previous) client-local day.
        const tz = await resolveClientTz(clientId);
        const now = new Date();
        const today = localDateIn(now, tz);
        const coversDate = addDays(today, -1);

        // First week (design B D4): no summary, no AI call, no quota.
        const due = firstSummaryOn(
          scope.activatedAt
            ? localDateIn(new Date(scope.activatedAt), tz)
            : null,
        );
        if (isFirstWeek(today, due)) {
          return {
            data: {
              state: "firstWeek",
              firstSummaryOn: due!,
              summary: null,
              coversDate,
              generatedAt: null,
              canManualRefresh: false,
              headline: null,
              areas: [],
              ask: null,
              weekOfProgramme: null,
            } satisfies WeeklySummaryModule,
          };
        }

        // 3. Per-coach daily ceiling (cost backstop). Successful inferences only.
        const usedToday = await usageRepo.countForUserToday(
          trainerId,
          AI_COACH_SUMMARY_ENDPOINT,
        );
        if (usedToday >= AI_COACH_SUMMARY_DAILY_LIMIT) {
          ctx.set.status = 429;
          return { error: "ai_daily_limit" };
        }

        // Coach read-audit (specs/27-coach-health-data-read-audit) — logged
        // only after the entitlement + daily-ceiling gates pass, i.e. once a
        // real read is about to happen (a cache hit still returns a summary of
        // the client's data). Logging before the
        // gates would over-report a "view" for coaches who get a 402/429 and
        // read no data.
        await auditClientDataRead({
          trainerId,
          clientId,
          dataCategory: "ai_summary",
          route: "/trainers/me/clients/:clientId/ai-summary",
        }).catch(() => {});

        // 5. Row-state.
        const existing = await summaryRepo.getForDay(
          trainerId,
          clientId,
          coversDate,
        );

        // "return cached, NO inference": a row exists AND (this is not a manual
        // refresh OR the one manual refresh is already spent).
        if (existing && (!manual || existing.refreshCount >= 1)) {
          const canManualRefresh =
            existing.refreshCount < 1 &&
            usedToday < AI_COACH_SUMMARY_DAILY_LIMIT;
          return { data: readyModule(existing, coversDate, canManualRefresh) };
        }

        // Per-user AI spend budget (spec-29 Phase 1): only the generate branch
        // spends AI, so a coach over budget can still open cached summaries.
        if (!(await hasAiBudget(trainerId, AI_COACH_SUMMARY_ENDPOINT))) {
          ctx.set.status = 429;
          return AI_BUDGET_EXHAUSTED_BODY;
        }

        // 6. Evidence (design B D4) — the one adherence calculation, the
        // programme week, form answers and plan meals. No photos, no notes.
        evidence = await loadWeeklySummaryEvidence(scope, tz, now);
        const allowed = availableAreas(evidence);
        if (allowed.length === 0) {
          // Nothing tracked and nothing logged: there is nothing to summarise,
          // so no AI call and no cache row. `summary: null` is the 1.2.0
          // empty state.
          return {
            data: {
              state: "ready",
              summary: null,
              coversDate,
              generatedAt: null,
              canManualRefresh: false,
              headline: null,
              areas: [],
              ask: null,
              weekOfProgramme: evidence.programme ?? null,
            } satisfies WeeklySummaryModule,
          };
        }
        requestSizeBytes = Buffer.byteLength(JSON.stringify(evidence));

        didInfer = true;
        const result = await generateClientSummary(evidence, allowed);
        const content = {
          summary: legacySummaryText(result),
          model: resolveSummaryModelId(),
          headline: result.headline,
          areas: result.areas,
          ask: result.ask,
          weekOfProgramme: evidence.programme ?? null,
        };

        // 7. Upsert.
        if (existing) {
          await summaryRepo.updateRefresh({
            trainerId,
            clientId,
            coversDate,
            ...content,
          });
        } else {
          const inserted = await summaryRepo.insertInitial({
            trainerId,
            clientId,
            coversDate,
            ...content,
          });
          if (!inserted) {
            // A concurrent open already wrote today's row (UNIQUE conflict). We
            // still spent this inference (recorded below), but return the
            // WINNER's cached row rather than a UNIQUE-violation 500 — the card
            // fills identically either way.
            const winner = await summaryRepo.getForDay(
              trainerId,
              clientId,
              coversDate,
            );
            if (winner) {
              const canManualRefresh =
                winner.refreshCount < 1 &&
                usedToday + 1 < AI_COACH_SUMMARY_DAILY_LIMIT;
              return {
                data: readyModule(winner, coversDate, canManualRefresh),
              };
            }
          }
        }

        // A manual refresh spends the one allowed refresh (refresh_count → 1);
        // an auto-gen leaves it at 0. After spending THIS inference, another
        // manual refresh is offered only if the coach stays under the ceiling.
        const refreshCountAfter = existing ? 1 : 0;
        const canManualRefresh =
          refreshCountAfter < 1 && usedToday + 1 < AI_COACH_SUMMARY_DAILY_LIMIT;

        const module: WeeklySummaryModule = {
          state: "ready",
          summary: content.summary,
          coversDate,
          generatedAt: new Date().toISOString(),
          canManualRefresh,
          headline: content.headline,
          areas: content.areas,
          ask: content.ask,
          weekOfProgramme: content.weekOfProgramme,
        };
        responseSizeBytes = Buffer.byteLength(JSON.stringify({ data: module }));
        return { data: module };
      } catch (error) {
        if (error instanceof ClientSummaryUnavailableError) {
          // Graceful degrade: the facts the summary would have used, and
          // never invented text. `error` is unchanged for 1.2.0 bundles.
          ctx.set.status = 503;
          return { error: "ai_unavailable", facts: evidence };
        }
        // EntitlementError (→ 402) and anything unexpected (→ 500) are mapped by
        // coreErrorHandler. Usage is still recorded below iff an inference ran.
        throw error;
      } finally {
        // Record ACTUAL inferences only (success OR a failed generation attempt
        // that reached the model), mirroring the nutrition usage-log gate. A
        // usage-log write failure never fails the user-facing response
        // (cross-cuts § 4.2).
        if (didInfer) {
          try {
            await usageRepo.record({
              userId: trainerId,
              endpoint: AI_COACH_SUMMARY_ENDPOINT,
              requestSizeBytes,
              responseSizeBytes,
              ms: Date.now() - startedAt,
            });
          } catch (logError) {
            console.error(
              `[ai-usage-log] failed to record ${AI_COACH_SUMMARY_ENDPOINT}: ${
                logError instanceof Error ? logError.message : String(logError)
              }`,
            );
          }
        }
      }
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      body: t.Optional(t.Object({ manual: t.Optional(t.Boolean()) })),
    },
  );

async function resolveClientTz(clientId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ tz: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.id, clientId))
    .limit(1);
  return safeTimeZone(rows[0]?.tz);
}

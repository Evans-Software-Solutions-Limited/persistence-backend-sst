import Elysia, { t } from "elysia";
import { eq } from "drizzle-orm";
import { profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditClientDataRead } from "../../relationships/auditClientDataRead";
import {
  assertEntitlement,
  EntitlementError,
} from "../../entitlement/assertEntitlement";
import { ClientDetailRepository } from "../../repositories/clientDetailRepository";
import { AiUsageLogRepository } from "../../repositories/aiUsageLogRepository";
import {
  AI_COACH_SUMMARY_DAILY_LIMIT,
  AI_COACH_SUMMARY_ENDPOINT,
  ClientAiSummaryRepository,
} from "../../repositories/clientAiSummaryRepository";
import {
  generateClientSummary,
  resolveSummaryModelId,
  ClientSummaryUnavailableError,
  type ClientSummaryInput,
} from "../services/clientSummaryAi";
import { addDaysISO, localDateISO } from "../../streaks/period";
import type {
  AiSummaryModule,
  ClientDetail,
} from "../../repositories/clientDetail";

const DEFAULT_TZ = "Europe/London";

/**
 * POST /trainers/me/clients/:clientId/ai-summary — generate (or return the
 * cached) coach AI Client Summary for the concluded client-local day
 * (specs/10-trainer-features/design.md § Module g, Phase 6). Body `{ manual? }`
 * — a single path for the lazy first generation and the one manual refresh.
 *
 * Gate/exec order (design.md § Module g endpoint):
 *   role → assertTrainerCanActForClient → assertEntitlement(ai_access) →
 *   per-coach daily-ceiling → ROW-STATE → generate (Bedrock) → upsert → usage.
 *
 * Row-state:
 *   - no row for covers_date            → generate (auto), insert refresh_count=0
 *   - row + manual=true + refresh_count<1 → regenerate, set refresh_count=1
 *   - else (manual false OR count ≥ 1)  → return CACHED, NO inference
 *
 * This is a WRITE that spends tokens but writes NO `trainer_actions_audit` row —
 * it is NOT a client-data mutation (nothing on the client's record changes),
 * only a per-coach cache is written. The privacy line holds: generation inputs
 * are Client Detail modules a–f (per-day totals + adherence), NEVER the
 * food-level entry log (design.md:605-606). Mounted as its own handler (a
 * sibling of the aggregate GET) to keep the root Elysia type instantiation
 * under TS's depth ceiling (TS2589).
 *
 * On any Bedrock failure the card degrades to the raw modules a–f
 * (design.md § Failure fallback) — surfaced here as 503 { error: "ai_unavailable" }
 * with NO usage row and NO cache write, so the mobile card simply shows the
 * modules and can retry.
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

      const summaryRepo = new ClientAiSummaryRepository();
      const usageRepo = new AiUsageLogRepository();

      try {
        // 1. Role + active relationship (cross-cuts § 1.3, role FIRST).
        const gate = await assertTrainerCanActForClient(trainerId, clientId);
        if (!gate.allowed) {
          ctx.set.status = gate.status;
          return gate.body;
        }

        // 2. Entitlement — the COACH's ai_access (trainer tiers carry it, M9.5).
        const entitlement = await assertEntitlement(trainerId, "ai_access");
        if (!entitlement.allowed) {
          throw new EntitlementError(entitlement, "ai_access");
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
        // real read is about to happen (a cache hit still reads the Client
        // Detail modules a–f used to ground the summary). Logging before the
        // gates would over-report a "view" for coaches who get a 402/429 and
        // read no data.
        await auditClientDataRead({
          trainerId,
          clientId,
          dataCategory: "ai_summary",
          route: "/trainers/me/clients/:clientId/ai-summary",
        }).catch(() => {});

        // 4. covers_date = the CONCLUDED (previous) client-local day.
        const tz = await resolveClientTz(clientId);
        const coversDate = addDaysISO(localDateISO(new Date(), tz), -1);

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
          return {
            data: {
              summary: existing.summary,
              coversDate,
              generatedAt: existing.generatedAt,
              canManualRefresh,
            } satisfies AiSummaryModule,
          };
        }

        // 6. Generate — assemble modules a–f from the SAME aggregate the card
        // displays (no second data pull; privacy-safe — totals + adherence).
        const detail = await new ClientDetailRepository().getClientDetail(
          trainerId,
          clientId,
        );
        const input = buildSummaryInput(detail, coversDate);
        requestSizeBytes = Buffer.byteLength(JSON.stringify(input));

        didInfer = true;
        const summary = await generateClientSummary(input);
        const model = resolveSummaryModelId();

        // 7. Upsert.
        if (existing) {
          await summaryRepo.updateRefresh({
            trainerId,
            clientId,
            coversDate,
            summary,
            model,
          });
        } else {
          const inserted = await summaryRepo.insertInitial({
            trainerId,
            clientId,
            coversDate,
            summary,
            model,
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
                data: {
                  summary: winner.summary,
                  coversDate,
                  generatedAt: winner.generatedAt,
                  canManualRefresh,
                } satisfies AiSummaryModule,
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

        const module: AiSummaryModule = {
          summary,
          coversDate,
          generatedAt: new Date().toISOString(),
          canManualRefresh,
        };
        responseSizeBytes = Buffer.byteLength(JSON.stringify({ data: module }));
        return { data: module };
      } catch (error) {
        if (error instanceof ClientSummaryUnavailableError) {
          // Graceful degrade — the card falls back to the raw modules a–f.
          ctx.set.status = 503;
          return { error: "ai_unavailable" };
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
  return rows[0]?.tz ?? DEFAULT_TZ;
}

/**
 * Project the Client Detail aggregate down to the modules a–f the summary is
 * grounded in. Deliberately EXCLUDES notes, recent-session names, and anything
 * that isn't a totals/adherence signal — the privacy line (design.md:605-606).
 */
function buildSummaryInput(
  detail: ClientDetail,
  coversDate: string,
): ClientSummaryInput {
  return {
    clientName: detail.client.name,
    coversDate,
    adherence: {
      overall: detail.adherence.overall,
      band: detail.adherence.band,
    },
    prs: detail.prs.map((p) => ({
      exerciseName: p.exerciseName,
      type: p.type,
      value: p.value,
      unit: p.unit,
    })),
    volume: { weekKg: detail.volume.weekKg },
    calorieHit: detail.calorieHit
      ? {
          targetKcal: detail.calorieHit.targetKcal,
          daysHit: detail.calorieHit.daysHit,
          daysLogged: detail.calorieHit.daysLogged,
          todayKcal: detail.calorieHit.todayKcal,
        }
      : null,
    goal: detail.goal
      ? {
          title: detail.goal.title,
          assignedByCoach: detail.goal.assignedByCoach,
          startKg: detail.goal.weight.startKg,
          nowKg: detail.goal.weight.nowKg,
          targetKg: detail.goal.weight.targetKg,
          pct: detail.goal.pct,
        }
      : null,
    habits: detail.habits
      ? {
          collectionStreak: detail.habits.collectionStreak,
          collectionSatisfied: detail.habits.collectionSatisfied,
          items: detail.habits.habits.map((h) => ({
            label: h.label,
            met: h.met,
          })),
        }
      : null,
    thisWeek: {
      workoutsCompleted: detail.thisWeek.workoutsCompleted,
      workoutsPlanned: detail.thisWeek.workoutsPlanned,
      prs: detail.thisWeek.prs,
    },
  };
}

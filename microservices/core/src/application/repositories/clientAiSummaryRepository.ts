import { and, desc, eq } from "drizzle-orm";
import { clientAiSummaries } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * The endpoint key the per-coach daily ceiling counts against
 * (design.md § Module g). Shared between the generate handler (which
 * records/counts) and the aggregate read (which counts to decide
 * `canManualRefresh`). Kept next to the repo so both import the SAME literal —
 * a drift here would silently split the counter from the ceiling.
 */
export const AI_COACH_SUMMARY_ENDPOINT =
  "/trainers/me/clients/:clientId/ai-summary";

/**
 * Per-COACH daily inference ceiling (design.md § Module g "Per-coach daily
 * backstop", #156 pattern). A cost backstop on top of the per-client
 * UNIQUE(trainer,client,covers_date) cap — net worst case is
 * min(2 × opened-clients, this). Counted against ACTUAL inferences only — a
 * call that reached the model writes `ai_usage_log` whether it succeeded or the
 * provider then failed (both incurred cost); cached reads and pre-model
 * rejections (403/402/429) do not.
 *
 * Fail-safe parse (mirrors AI_PHOTO_DAILY_LIMIT in
 * `nutritionAiEstimateHandler.ts`): a mis-set env var (garbage → NaN, "" → 0)
 * must NOT silently disable the guard — anything non-finite / non-positive
 * falls back to the default.
 */
const parsedSummaryLimit = Number(process.env.AI_COACH_SUMMARY_DAILY_LIMIT);
export const AI_COACH_SUMMARY_DAILY_LIMIT =
  Number.isFinite(parsedSummaryLimit) && parsedSummaryLimit > 0
    ? parsedSummaryLimit
    : 40;

export type ClientAiSummaryRow = {
  id: string;
  summary: string;
  model: string;
  refreshCount: number;
  generatedAt: string; // ISO
};

/**
 * Cache access for the coach AI Client Summary (design.md § Module g). One row
 * per (trainer, client, concluded client-local day). Reads NEVER trigger
 * inference — this is a plain SQL cache. All writes are scoped to
 * (trainerId, clientId, coversDate); the DB's UNIQUE(trainer, client,
 * covers_date) is the structural once-a-day cap.
 *
 * Constructed directly by the handler / aggregate repo (not DI-decorated), the
 * same rationale as `ClientDetailRepository` — keeps the Elysia root type
 * instantiation under TS's depth ceiling (TS2589).
 */
export class ClientAiSummaryRepository {
  static readonly key = "ClientAiSummaryRepository";

  /**
   * The cached summary row for this (trainer, client) covering `coversDate`, or
   * null if none has been generated yet. `covers_date` is a single day so this
   * is at most one row; the DESC index makes it a point lookup.
   */
  async getForDay(
    trainerId: string,
    clientId: string,
    coversDate: string,
  ): Promise<ClientAiSummaryRow | null> {
    const db = getDb();
    const rows = await db
      .select({
        id: clientAiSummaries.id,
        summary: clientAiSummaries.summary,
        model: clientAiSummaries.model,
        refreshCount: clientAiSummaries.refreshCount,
        generatedAt: clientAiSummaries.generatedAt,
      })
      .from(clientAiSummaries)
      .where(
        and(
          eq(clientAiSummaries.trainerId, trainerId),
          eq(clientAiSummaries.clientId, clientId),
          eq(clientAiSummaries.coversDate, coversDate),
        ),
      )
      .orderBy(desc(clientAiSummaries.coversDate))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      summary: r.summary,
      model: r.model,
      refreshCount: r.refreshCount,
      generatedAt:
        r.generatedAt instanceof Date
          ? r.generatedAt.toISOString()
          : String(r.generatedAt),
    };
  }

  /**
   * The initial lazy generation — insert a fresh row with refresh_count = 0.
   * Conflict-tolerant: two near-simultaneous opens both see "no row" and both
   * reach here; `onConflictDoNothing` on the UNIQUE(trainer, client,
   * covers_date) key lets the loser no-op instead of raising a 500. Returns
   * `true` when THIS call wrote the row, `false` when another concurrent open
   * already had — the handler then returns that winner's cached row.
   */
  async insertInitial(input: {
    trainerId: string;
    clientId: string;
    coversDate: string;
    summary: string;
    model: string;
  }): Promise<boolean> {
    const db = getDb();
    const inserted = await db
      .insert(clientAiSummaries)
      .values({
        trainerId: input.trainerId,
        clientId: input.clientId,
        coversDate: input.coversDate,
        summary: input.summary,
        model: input.model,
        refreshCount: 0,
      })
      .onConflictDoNothing({
        target: [
          clientAiSummaries.trainerId,
          clientAiSummaries.clientId,
          clientAiSummaries.coversDate,
        ],
      })
      .returning({ id: clientAiSummaries.id });
    return inserted.length > 0;
  }

  /**
   * The one manual refresh — overwrite the day's row, bump refresh_count to 1,
   * and restamp generated_at. Scoped to (trainer, client, coversDate) so it can
   * never touch another day or another coach's row.
   */
  async updateRefresh(input: {
    trainerId: string;
    clientId: string;
    coversDate: string;
    summary: string;
    model: string;
  }): Promise<void> {
    const db = getDb();
    await db
      .update(clientAiSummaries)
      .set({
        summary: input.summary,
        model: input.model,
        refreshCount: 1,
        generatedAt: new Date(),
      })
      .where(
        and(
          eq(clientAiSummaries.trainerId, input.trainerId),
          eq(clientAiSummaries.clientId, input.clientId),
          eq(clientAiSummaries.coversDate, input.coversDate),
        ),
      );
  }
}

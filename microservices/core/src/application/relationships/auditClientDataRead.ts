import { and, eq, gte } from "drizzle-orm";
import { clientDataAccessLog } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * De-dupe window, in minutes, for repeat reads of the same
 * (trainer_id, client_id, data_category). Applies to every category, not
 * just the high-volume `client_detail_aggregate` (the Client Detail screen
 * re-fetches on every focus) — coarsening every category the same way keeps
 * the table proportional to "did trainer X view client Y's category Z
 * recently" rather than one row per request/poll. Tunable.
 */
export const DEDUPE_WINDOW_MINUTES = 15;

export interface AuditClientDataReadArgs {
  trainerId: string;
  clientId: string;
  dataCategory: string;
  route: string;
}

/**
 * Append-only read-audit for coach reads of client health/fitness data
 * (specs/27-coach-health-data-read-audit — UK GDPR Art 5(2) accountability:
 * we must be able to show which coach viewed which client's data, when, via
 * which route). This is the read-side counterpart to `trainer_actions_audit`
 * (which only covers on-behalf WRITES).
 *
 * Callers MUST invoke this AFTER `assertTrainerCanActForClient` (or
 * equivalent) has already returned `allowed: true` — this helper does not
 * itself re-check authorization, so calling it unconditionally would log
 * denied/unauthorized attempts as if they were reads.
 *
 * BEST-EFFORT: NEVER throws. A logging failure (missing table, transient DB
 * error, etc.) must never fail, block, or delay the caller's read — same
 * posture as `notifyRelationshipEnded`. Errors are logged via
 * `console.warn` and swallowed.
 *
 * De-dupe: within `DEDUPE_WINDOW_MINUTES` of the same (trainer_id, client_id,
 * data_category), the write is skipped — see the constant's doc comment.
 */
export async function auditClientDataRead({
  trainerId,
  clientId,
  dataCategory,
  route,
}: AuditClientDataReadArgs): Promise<void> {
  try {
    const db = getDb();
    const since = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60_000);

    const recent = await db
      .select({ id: clientDataAccessLog.id })
      .from(clientDataAccessLog)
      .where(
        and(
          eq(clientDataAccessLog.trainerId, trainerId),
          eq(clientDataAccessLog.clientId, clientId),
          eq(clientDataAccessLog.dataCategory, dataCategory),
          gte(clientDataAccessLog.createdAt, since),
        ),
      )
      .limit(1);

    if (recent[0]) return;

    await db.insert(clientDataAccessLog).values({
      trainerId,
      clientId,
      dataCategory,
      route,
    });
  } catch (err) {
    console.warn(
      `[read-audit] failed to log client-data read (${dataCategory}) trainer=${trainerId} client=${clientId} route=${route}`,
      err,
    );
  }
}

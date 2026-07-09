import { eq } from "drizzle-orm";
import { profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import {
  NotificationRepository,
  type AppNotification,
} from "../../repositories/notificationRepository";
import { NotificationDispatcher } from "../../notifications/push/notificationDispatcher";

/**
 * Where a tapped brief lands: the athlete Training page (Train tab →
 * Training segment). Scheme-host form so the backend stays decoupled from
 * the mobile router's file layout — mobile's deep-link resolver owns the
 * mapping (same convention as `persistencemobile://requests`).
 */
export const CLIENT_BRIEF_DEEP_LINK = "persistencemobile://train";

/** Max brief length, shared with the handler's body validator. */
export const CLIENT_BRIEF_MAX_LENGTH = 500;

/**
 * Fallback title when the trainer's profile row is missing or has no
 * `full_name` — mirrors `onBehalfNotifications.ts`'s "your coach" posture
 * (sensible copy, no raw id leak).
 */
const FALLBACK_BRIEF_TITLE = "Brief from your coach";

export interface SendClientBriefArgs {
  trainerId: string;
  clientId: string;
  /** Free-text brief body — already trimmed + length-validated by the handler. */
  message: string;
}

export type SendClientBriefResult =
  | { ok: true; notification: AppNotification }
  | { ok: false; status: 403; body: { code: string; message: string } };

/**
 * Notification title carrying the coach's real name, per the Phase-11
 * attribution copy conventions: "Coach {name}" for a personal trainer,
 * bare "{name}" for a physio ("Set by Coach X" / "Set by X" precedent).
 */
function briefTitle(
  trainer: { fullName: string | null; role: string | null } | undefined,
): string {
  if (!trainer?.fullName) return FALLBACK_BRIEF_TITLE;
  return trainer.role === "physiotherapist"
    ? `Brief from ${trainer.fullName}`
    : `Brief from Coach ${trainer.fullName}`;
}

/**
 * Shared core for a coach sending a client a free-text brief (M17 "Send
 * brief"). Unlike the other on-behalf writes, the client's NOTIFICATION ROW
 * is itself the deliverable — there is no companion domain table — so it is
 * created INSIDE the transaction with the audit row, and only the push
 * delivery is post-commit best-effort:
 *
 *   1. `assertTrainerCanActForClient` gate (cross-cuts § 1.3).
 *   2. Notification insert (`coach_brief`, deep-linking the athlete Training
 *      page) + `trainer_actions_audit` (`brief_sent`) in ONE transaction
 *      (cross-cuts § 1.4.2).
 *   3. Push fan-out post-commit via `NotificationDispatcher.dispatchExisting`
 *      — best-effort, never fails the write (cross-cuts § 5).
 */
export async function sendClientBriefOnBehalf({
  trainerId,
  clientId,
  message,
}: SendClientBriefArgs): Promise<SendClientBriefResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  // Resolve the coach's display name + role for the title BEFORE the
  // transaction — a read, so it doesn't belong inside the write tx. A missing
  // row falls back to generic copy rather than failing the send.
  const trainerRows = await getDb()
    .select({ fullName: profiles.fullName, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, trainerId))
    .limit(1);

  const notifications = new NotificationRepository();

  const notification = await getDb().transaction(async (tx) => {
    const created = await notifications.create(
      clientId,
      {
        type: "coach_brief",
        title: briefTitle(trainerRows[0]),
        message,
        data: { deepLink: CLIENT_BRIEF_DEEP_LINK },
      },
      tx,
    );

    await auditTrainerAction({
      trainerId,
      clientId,
      actionType: "brief_sent",
      targetTable: "notifications",
      targetRowId: created.id,
      payload: { message },
      tx,
    });

    return created;
  });

  // Post-commit, best-effort: `dispatchExisting` never throws (preference
  // gate + device fan-out + dead-token retirement all inside its catch).
  await new NotificationDispatcher().dispatchExisting(clientId, notification);

  return { ok: true, notification };
}

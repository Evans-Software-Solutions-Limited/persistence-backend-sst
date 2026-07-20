import { eq } from "drizzle-orm";
import { profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { NotificationDispatcher } from "../notifications/push/notificationDispatcher";

export interface NotifyRelationshipEndedArgs {
  /** Who RECEIVES the notification (the counterparty of the actor). */
  recipientId: string;
  /** Whose display name appears in the copy (the actor). */
  otherPartyId: string;
  /** 'trainer' = coach removed the client; 'client' = client left the coach. */
  initiatedBy: "trainer" | "client";
  relationshipId: string;
}

/**
 * Best-effort counterparty notification for a coach↔client relationship end
 * (25-coach-client-offboarding). Called by the endpoint handlers AFTER the
 * teardown transaction has committed.
 *
 * NEVER throws: the relationship is already ended, so a notification hiccup
 * (missing profile, push failure, transient DB error) must not fail the
 * action — same posture as `emitTrainerOnBehalfNotification`. Errors are
 * logged and swallowed.
 *
 * Direction:
 *   - initiatedBy 'trainer' → the CLIENT is notified that their coach ended
 *     the relationship; copy names the coach.
 *   - initiatedBy 'client'  → the COACH is notified that the client left;
 *     copy names the client.
 */
export async function notifyRelationshipEnded({
  recipientId,
  otherPartyId,
  initiatedBy,
  relationshipId,
}: NotifyRelationshipEndedArgs): Promise<void> {
  try {
    const rows = await getDb()
      .select({ fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.id, otherPartyId))
      .limit(1);

    const fallback = initiatedBy === "trainer" ? "Your coach" : "A client";
    const name = rows[0]?.fullName ?? fallback;

    const title =
      initiatedBy === "trainer" ? "Coaching ended" : "A client left";
    const message =
      initiatedBy === "trainer"
        ? `${name} has ended your coaching relationship. Any workouts and programmes they assigned have been removed — your habits and goals stay with you.`
        : `${name} has left your coaching.`;

    await new NotificationDispatcher().createAndDispatch(recipientId, {
      type: "coaching_relationship_ended",
      title,
      message,
      relatedEntityType: "pt_client_relationship",
      relatedEntityId: relationshipId,
    });
  } catch (err) {
    console.error(
      `[offboarding] failed to emit coaching_relationship_ended notification for ${recipientId}`,
      err,
    );
  }
}

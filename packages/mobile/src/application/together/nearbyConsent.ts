import type { WorkoutSession } from "@/domain/models/session";
import type {
  TogetherPreviousRow,
  TogetherSharedPort,
  TogetherSharingConsent,
} from "@/domain/ports/togetherShared.port";

/** Previous values for the exercises still in this workout. */
export function currentPreviousRows(
  workout: WorkoutSession,
  rows: readonly TogetherPreviousRow[],
) {
  const exerciseIds = new Set(
    workout.exercises
      .filter((exercise) => !exercise.skipped)
      .map((exercise) => exercise.exerciseId),
  );
  return rows.filter((row) => exerciseIds.has(row.exerciseId));
}

/**
 * Grants (or revokes) what one person in a Nearby session may see, then
 * publishes previous values straight after: the cached rows first, then the
 * refreshed ones if the grant is still the same. Used by the workout's
 * sharing sheet and by Together settings' live card (PER-60).
 */
export async function applyNearbyConsent(p: {
  shared: TogetherSharedPort;
  accountId: string;
  recipient: string;
  consent: TogetherSharingConsent;
  /** False once a newer request, session or account has taken over. */
  stillCurrent(): boolean;
  getWorkout?(): WorkoutSession | null | undefined;
  getPrevious?(): readonly TogetherPreviousRow[];
  refreshPrevious?(
    isCurrent: () => boolean,
  ): Promise<readonly TogetherPreviousRow[] | null>;
}): Promise<void> {
  const { shared, accountId, recipient, consent, stillCurrent } = p;
  await shared.setConsent(recipient, consent);
  if (!stillCurrent()) return;
  const current = p.getWorkout?.();
  if (!consent.prev || current?.userId !== accountId || !p.getPrevious) return;
  const grantOf = () =>
    shared
      .getSnapshot()
      .grants.find(
        (g) => g.ownerId === accountId && g.recipientId === recipient,
      );
  const grantVersion = grantOf()?.version;
  await shared.publishPrevious(
    recipient,
    currentPreviousRows(current, p.getPrevious()),
    Date.parse(current.startedAt),
  );
  if (!stillCurrent() || !p.refreshPrevious) return;
  const rows = await p.refreshPrevious(stillCurrent);
  if (rows === null) return;
  const fresh = p.getWorkout?.();
  if (
    !stillCurrent() ||
    fresh?.id !== current.id ||
    fresh.userId !== accountId ||
    fresh.startedAt !== current.startedAt
  )
    return;
  const grant = grantOf();
  if (!grant?.consent.prev || grant.version !== grantVersion) return;
  await shared.publishPrevious(
    recipient,
    currentPreviousRows(fresh, rows),
    Date.parse(current.startedAt),
  );
}

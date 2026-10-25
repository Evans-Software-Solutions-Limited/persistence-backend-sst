import type {
  TogetherAthleteProjection,
  TogetherSharedSnapshot,
} from "@/domain/ports/togetherShared.port";

/** What the viewer may see and do on one partner's workout (PER-60). */
export function togetherPartnerAccess(
  snapshot: TogetherSharedSnapshot,
  ownerId: string,
  accountId: string,
): {
  numbers: boolean;
  prev: boolean;
  editable: boolean;
  grantVersion: number;
  projection?: TogetherAthleteProjection;
} {
  const grant = snapshot.grants.find(
    (g) => g.ownerId === ownerId && g.recipientId === accountId,
  );
  const numbers = !!grant?.consent.numbers;
  const projection = numbers
    ? snapshot.athletes.find((a) => a.userId === ownerId)
    : undefined;
  return {
    numbers,
    prev: numbers && !!grant?.consent.prev,
    // Fill-in needs the numbers grant, the fill-in grant and a revision to write against.
    editable: !!projection && !!grant?.consent.logging,
    grantVersion: grant?.version ?? 0,
    projection,
  };
}

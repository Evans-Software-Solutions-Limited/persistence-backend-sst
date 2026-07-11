import { Text, View } from "@tamagui/core";
import { Avatar, Btn, Card } from "@/ui/components/foundation";
import { initialsOf } from "@/shared/utils";

/**
 * <TrainerProgressPresenter> — the "Your trainer" block on the athlete You
 * page (10-trainer-features + Coach Mode Phase 8 — invite/QR). Shows:
 *
 *  - an ALWAYS-available "Have a coach's code?" entry point into the redeem
 *    flow (Phase 8, net-new — renders even with no trainer and no pending,
 *    per the parent `<Section>`'s loosened render condition);
 *  - when there are pending TRAINER-initiated requests (an email invite or
 *    an invite code the athlete hasn't redeemed — the athlete is the one who
 *    accepts), a prompt to review them on the Requests screen;
 *  - when the athlete has redeemed a coach's invite code and is awaiting the
 *    COACH's accept (`myPendingCoachRequests`, Phase 8 net-new), a quiet
 *    "awaiting acceptance" line per pending coach — non-interactive, there's
 *    nothing for the athlete to action;
 *  - the active coach relationship (who + since when).
 *
 * Pure presentational; trainer-tone accent to match the coach surfaces.
 */

export type TrainerProgressData = {
  name: string;
  role: string | null;
  since: string | null;
};

/** A client-initiated pending row awaiting the COACH's accept (Phase 8). */
export type MyPendingCoachRequest = {
  relationshipId: string;
  trainerName: string;
};

export type TrainerProgressProps = {
  trainer: TrainerProgressData | null;
  /** Count of pending TRAINER-initiated requests the athlete can review. */
  pendingRequestCount: number;
  /** The athlete's own client-initiated pendings, awaiting coach accept. */
  myPendingCoachRequests?: MyPendingCoachRequest[];
  onOpenRequests: () => void;
  /** Navigate to the invite-code redeem screen (Phase 8). */
  onOpenAcceptInvite: () => void;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function roleLabel(role: string | null): string {
  switch (role) {
    case "physiotherapist":
      return "Physiotherapist";
    case "personal_trainer":
      return "Personal Trainer";
    case "admin":
      return "Coach";
    default:
      return "Trainer";
  }
}

/** "Working together since Mar 2026", or just the role when no date. */
function sinceCaption(role: string | null, since: string | null): string {
  if (!since) return roleLabel(role);
  const d = new Date(since);
  if (Number.isNaN(d.getTime())) return roleLabel(role);
  return `${roleLabel(role)} · since ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function TrainerProgressPresenter({
  trainer,
  pendingRequestCount,
  myPendingCoachRequests = [],
  onOpenRequests,
  onOpenAcceptInvite,
}: TrainerProgressProps) {
  return (
    <View gap={12} testID="you-trainer">
      <Card testID="you-accept-invite-entry">
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          gap={12}
        >
          <View flex={1}>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={15}
              color="$text"
            >
              Have a coach&apos;s code?
            </Text>
            <Text fontSize={12.5} color="$text3" marginTop={2}>
              Enter it (or scan the QR) to start training together.
            </Text>
          </View>
          <Btn
            variant="outline"
            tone="trainer"
            size="sm"
            onPress={onOpenAcceptInvite}
            testID="you-accept-invite-button"
          >
            Enter code
          </Btn>
        </View>
      </Card>

      {myPendingCoachRequests.map((req) => (
        <Card
          key={req.relationshipId}
          surface={0}
          testID={`you-pending-coach-request-${req.relationshipId}`}
        >
          <Text fontFamily="$body" fontSize={13} color="$text2">
            {`Request sent to ${req.trainerName} — awaiting acceptance`}
          </Text>
        </Card>
      ))}

      {pendingRequestCount > 0 ? (
        <Card accent="trainer" testID="you-trainer-pending">
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            gap={12}
          >
            <View flex={1}>
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={15}
                color="$text"
              >
                {pendingRequestCount === 1
                  ? "1 pending request"
                  : `${pendingRequestCount} pending requests`}
              </Text>
              <Text fontSize={12.5} color="$text3" marginTop={2}>
                A coach wants to connect with you.
              </Text>
            </View>
            <Btn
              variant="filled"
              tone="trainer"
              size="sm"
              onPress={onOpenRequests}
              testID="you-trainer-review"
            >
              Review
            </Btn>
          </View>
        </Card>
      ) : null}

      {trainer ? (
        <Card testID="you-trainer-active">
          <View flexDirection="row" alignItems="center" gap={12}>
            <Avatar
              size={44}
              tone="trainer"
              initials={initialsOf(trainer.name) || "?"}
            />
            <View flex={1}>
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={16}
                color="$text"
              >
                {trainer.name}
              </Text>
              <Text fontSize={12.5} color="$text3" marginTop={2}>
                {sinceCaption(trainer.role, trainer.since)}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

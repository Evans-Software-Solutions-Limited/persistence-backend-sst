import { Text, View } from "@tamagui/core";
import { Avatar, Btn, Card } from "@/ui/components/foundation";
import { initialsOf } from "@/shared/utils";

/**
 * <TrainerProgressPresenter> — the "Your trainer" block on the athlete You
 * page (10-trainer-features). Shows the active coach relationship (who +
 * since when) and, when there are pending coach requests, a prompt to review
 * them. Pure presentational; trainer-tone accent to match the coach surfaces.
 */

export type TrainerProgressData = {
  name: string;
  role: string | null;
  since: string | null;
};

export type TrainerProgressProps = {
  trainer: TrainerProgressData | null;
  pendingRequestCount: number;
  onOpenRequests: () => void;
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
  onOpenRequests,
}: TrainerProgressProps) {
  return (
    <View gap={12} testID="you-trainer">
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

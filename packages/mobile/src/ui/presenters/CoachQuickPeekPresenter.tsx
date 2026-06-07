import { Text, View } from "@tamagui/core";
import { Card, Btn, Pill } from "@/ui/components/foundation";

/**
 * <CoachQuickPeekPresenter> — Home coach peek (06-progress-goals, STORY-002 AC
 * 2.6; home.jsx:374–393). The slot + gate live here; richer coach content is
 * owned by 10-trainer-features. Rendered only when useUserMode().mode==='coach'
 * (gated by the container).
 */

export type CoachQuickPeekProps = {
  clientCount: number;
  needAttention: number;
  newPRs: number;
  onOpenCoach: () => void;
  testID?: string;
};

export function CoachQuickPeekPresenter({
  clientCount,
  needAttention,
  newPRs,
  onOpenCoach,
  testID = "coach-quick-peek",
}: CoachQuickPeekProps) {
  return (
    <Card pad={16} radius={16} accent="trainer" testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        marginBottom={10}
      >
        <View>
          <Text
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            color="$accentTrainer"
            marginBottom={4}
          >
            COACHING · {clientCount} CLIENTS
          </Text>
          <Text fontSize={18} fontWeight="700" color="$text">
            {needAttention} need attention
          </Text>
        </View>
        <Btn variant="soft" tone="trainer" size="sm" onPress={onOpenCoach}>
          Open
        </Btn>
      </View>
      <View flexDirection="row" gap={6}>
        <Pill tone="trainer" size="xs">
          {needAttention} missed yesterday
        </Pill>
        {newPRs > 0 && (
          <Pill tone="ember" size="xs">
            {newPRs} PR to review
          </Pill>
        )}
      </View>
    </Card>
  );
}

import { Text, View } from "@tamagui/core";
import { Card, IconBtn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconFire, IconPlay } from "@/ui/components/icons";

/**
 * <YourTrainingPeekPresenter> — the coach's OWN training peek on Coach You.
 * Ports the prototype's `YourTrainingPeek` (design-source/screens/coach.jsx:
 * 193-223): a "YOUR TRAINING / You're on a streak" header over an ember-glow
 * card with a flame tile, the streak count + "day streak", today's/last
 * session caption, and a primary play IconBtn.
 *
 * Data is the coach's athlete-side streak + latest session (reused, no new
 * backend). When the streak is 0/absent the heading drops the brag and the
 * card still renders the streak number (0).
 *
 * Exported separately so Coach Home can reuse it later.
 */

export type YourTrainingPeekPresenterProps = {
  streakCount: number;
  /** Streak unit label, e.g. "day" / "week". Defaults to "day". */
  streakUnit?: string;
  /** Last/today session caption, e.g. "Today's session: Upper Body · 45m". */
  sessionCaption: string | null;
  onStartSession?: () => void;
  testID?: string;
};

export function YourTrainingPeekPresenter({
  streakCount,
  streakUnit = "day",
  sessionCaption,
  onStartSession,
  testID,
}: YourTrainingPeekPresenterProps) {
  const emberInk = toneHex("ember").ink;
  const hasStreak = streakCount > 0;

  return (
    <View testID={testID}>
      <View paddingHorizontal={2} marginBottom={10}>
        <Text
          fontFamily="$display"
          fontSize={10.5}
          fontWeight="600"
          letterSpacing={1.7}
          textTransform="uppercase"
          color="$text3"
        >
          Your training
        </Text>
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={24}
          letterSpacing={-0.5}
          color="$text"
        >
          {hasStreak ? "You're on a streak" : "Your training"}
        </Text>
      </View>

      <Card
        pad={16}
        radius={16}
        accent="ember"
        style={{ backgroundColor: "#12141D" }}
      >
        <View flexDirection="row" alignItems="center" gap={14}>
          <View
            width={56}
            height={56}
            borderRadius={14}
            alignItems="center"
            justifyContent="center"
            style={{ backgroundColor: toneHex("ember").base }}
          >
            <IconFire size={28} color={emberInk} strokeWidth={2} />
          </View>
          <View flex={1}>
            <View flexDirection="row" alignItems="baseline" gap={6}>
              <Text
                fontFamily="$mono"
                fontWeight="700"
                fontSize={28}
                letterSpacing={-1}
                color="$text"
              >
                {streakCount}
              </Text>
              <Text fontFamily="$mono" fontSize={12} color="$text3">
                {streakUnit} streak
              </Text>
            </View>
            {sessionCaption ? (
              <Text
                fontFamily="$body"
                fontSize={12}
                color="$text3"
                marginTop={2}
              >
                {sessionCaption}
              </Text>
            ) : null}
          </View>
          <IconBtn
            icon={<IconPlay size={14} />}
            tone="primary"
            onPress={onStartSession}
            accessibilityLabel="Start a session"
            testID="coach-training-play"
          />
        </View>
      </Card>
    </View>
  );
}

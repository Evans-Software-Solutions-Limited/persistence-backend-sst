import { Text, View } from "@tamagui/core";
import { Card, Btn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconFlame } from "@/ui/components/icons";

/**
 * <StreakHeroPresenter> — You/Progress streak hero (06-progress-goals,
 * STORY-003 AC 3.2; progress.jsx:73–110). Ember-accent card: 80×80 flame tile,
 * display streak + longest, freeze-token sub-card with a "Use" button.
 */

export type StreakHeroProps = {
  current: number;
  longest: number;
  freezeTokens: number;
  /** "days" (daily) or "weeks" (weekly). */
  unit: string;
  onUseToken: () => void;
  busy?: boolean;
  testID?: string;
};

export function StreakHeroPresenter({
  current,
  longest,
  freezeTokens,
  unit,
  onUseToken,
  busy = false,
  testID = "streak-hero",
}: StreakHeroProps) {
  return (
    <Card pad={20} radius={20} accent="ember" testID={testID}>
      <View flexDirection="row" gap={16} alignItems="center">
        <View
          width={80}
          height={80}
          borderRadius={20}
          backgroundColor="$ember"
          alignItems="center"
          justifyContent="center"
        >
          <IconFlame size={42} color={toneHex("ember").ink} />
        </View>
        <View flex={1}>
          <Text
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            color="$ember"
          >
            CURRENT STREAK
          </Text>
          <View flexDirection="row" alignItems="baseline" gap={6} marginTop={4}>
            <Text
              fontFamily="$mono"
              fontSize={40}
              fontWeight="700"
              color="$text"
            >
              {current}
            </Text>
            <Text fontFamily="$mono" fontSize={13} color="$text3">
              {unit}
            </Text>
          </View>
          <Text fontSize={12.5} color="$text2" marginTop={2}>
            Longest:{" "}
            <Text color="$gold">
              {longest} {unit}
            </Text>
          </Text>
        </View>
      </View>

      <View
        marginTop={16}
        padding={12}
        backgroundColor="$surface2"
        borderRadius={12}
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <View flexDirection="row" alignItems="center" gap={10} flex={1}>
          <Text fontSize={22}>🧊</Text>
          <View flex={1}>
            <Text fontSize={13} fontWeight="600" color="$text">
              {freezeTokens} freeze {freezeTokens === 1 ? "token" : "tokens"}
            </Text>
            <Text fontSize={11} color="$text3">
              Skip a day without breaking your streak
            </Text>
          </View>
        </View>
        <Btn
          variant="soft"
          tone="primary"
          size="sm"
          disabled={busy || freezeTokens <= 0}
          onPress={onUseToken}
        >
          Use
        </Btn>
      </View>
    </Card>
  );
}

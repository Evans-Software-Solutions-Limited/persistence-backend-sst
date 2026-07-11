import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { Card, Pill } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconDumbbell, IconSwap, iconDefaults } from "@/ui/components/icons";

/**
 * <TrainYourselfCardPresenter> — Coach Home "Train yourself" block. Ports the
 * prototype `CoachHome` train-yourself card (design-source/screens/
 * coach-home.jsx:127-152) 1:1: a primary-accented Card (cyan left border) with
 * an IconDumbbell tile + "Train yourself" + a "SWITCHES MODE" pill + a peek
 * subtitle + IconSwap. Tapping switches the app to athlete mode.
 */

export type TrainYourselfCardPresenterProps = {
  /** Peek line, e.g. "Switch to athlete view · 23-day streak · Upper Body queued". */
  subtitle: string;
  onTrainYourself: () => void;
  testID?: string;
};

export function TrainYourselfCardPresenter({
  subtitle,
  onTrainYourself,
  testID,
}: TrainYourselfCardPresenterProps) {
  const primary = toneHex("primary");

  return (
    <Card
      pad={0}
      radius={16}
      accent="primary"
      style={{ borderLeftWidth: 3, borderLeftColor: primary.base }}
      testID={testID}
    >
      <Pressable
        onPress={onTrainYourself}
        accessibilityRole="button"
        accessibilityLabel="Train yourself — switches to athlete mode"
        testID="coach-home-train-yourself"
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        <View
          flexDirection="row"
          alignItems="center"
          gap={12}
          padding={14}
          paddingHorizontal={16}
        >
          <View
            width={40}
            height={40}
            borderRadius={10}
            backgroundColor={primary.dim}
            alignItems="center"
            justifyContent="center"
          >
            <IconDumbbell
              {...iconDefaults({ size: 20 })}
              color={primary.base}
            />
          </View>
          <View flex={1} minWidth={0}>
            <View flexDirection="row" alignItems="center" gap={6}>
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={15}
                color="$text"
              >
                Train yourself
              </Text>
              <Pill tone="primary" size="xs">
                SWITCHES MODE
              </Pill>
            </View>
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$text3"
              marginTop={2}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          </View>
          <IconSwap {...iconDefaults({ size: 16 })} color={primary.base} />
        </View>
      </Pressable>
    </Card>
  );
}

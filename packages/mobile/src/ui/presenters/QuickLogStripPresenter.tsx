import { Text, View } from "@tamagui/core";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconArrowUp,
  IconApple,
  IconDroplet,
  IconClock,
} from "@/ui/components/icons";

/**
 * <QuickLogStripPresenter> — Home quick-capture row (06-progress-goals,
 * STORY-002/005; home.jsx:271–294). Tap targets opening the matching
 * sheets/routes.
 *
 * The legacy "Mood" tile was dropped at launch — it was a no-op with no
 * backing store. "Sleep" (specs/20-sleep-quicklog) is its durable-backend +
 * HealthKit replacement, re-adding a fourth target — icon + tone (IconClock,
 * success) matches the Home "sleep" MicroPill (TodayHeroPresenter).
 */

export type QuickLogStripProps = {
  onWeighIn: () => void;
  onLogMeal: () => void;
  onLogWater: () => void;
  onSleep: () => void;
  testID?: string;
};

export function QuickLogStripPresenter({
  onWeighIn,
  onLogMeal,
  onLogWater,
  onSleep,
  testID = "quick-log-strip",
}: QuickLogStripProps) {
  const items = [
    {
      key: "weigh",
      icon: <IconArrowUp size={16} color={toneHex("primary").base} />,
      label: "Weigh in",
      onPress: onWeighIn,
    },
    {
      key: "meal",
      icon: <IconApple size={16} color={toneHex("gold").base} />,
      label: "Log meal",
      onPress: onLogMeal,
    },
    {
      key: "water",
      icon: <IconDroplet size={16} color={toneHex("primary").base} />,
      label: "Water",
      onPress: onLogWater,
    },
    {
      key: "sleep",
      icon: <IconClock size={16} color={toneHex("success").base} />,
      label: "Sleep",
      onPress: onSleep,
    },
  ];

  return (
    <View flexDirection="row" gap={8} testID={testID}>
      {items.map((it) => (
        <View
          key={it.key}
          flex={1}
          onPress={it.onPress}
          accessibilityRole="button"
          accessibilityLabel={it.label}
          borderWidth={1}
          borderColor="$border"
          backgroundColor="$surface2"
          borderRadius={12}
          paddingVertical={10}
          paddingHorizontal={6}
          alignItems="center"
          gap={6}
          pressStyle={{ opacity: 0.7 }}
        >
          {it.icon}
          <Text fontSize={11} fontWeight="500" color="$text2">
            {it.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

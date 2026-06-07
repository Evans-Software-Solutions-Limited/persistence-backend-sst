import { Text, View } from "@tamagui/core";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconArrowUp,
  IconApple,
  IconDroplet,
  IconHeart,
} from "@/ui/components/icons";

/**
 * <QuickLogStripPresenter> — Home quick-capture row (06-progress-goals,
 * STORY-002/005; home.jsx:271–294). Four tap targets opening the matching
 * sheets/routes.
 */

export type QuickLogStripProps = {
  onWeighIn: () => void;
  onLogMeal: () => void;
  onLogWater: () => void;
  onLogMood: () => void;
  testID?: string;
};

export function QuickLogStripPresenter({
  onWeighIn,
  onLogMeal,
  onLogWater,
  onLogMood,
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
      key: "mood",
      icon: <IconHeart size={16} color={toneHex("ember").base} />,
      label: "Mood",
      onPress: onLogMood,
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

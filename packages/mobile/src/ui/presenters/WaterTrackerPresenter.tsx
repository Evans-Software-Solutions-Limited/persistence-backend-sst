import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
import { Card, IconBtn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconDroplet, IconMinus, IconPlus } from "@/ui/components/icons";

/**
 * <WaterTrackerPresenter> — cups grid vs goal (nutrition.jsx:178–214). Tap a cup
 * to set the count to that index+1; +/- step by one. Every tap fires a haptic in
 * the container (selectionAsync). Auto-resets at user-local midnight because the
 * day key in `cached_fuel_today` rolls over (handled upstream).
 *
 * Pure: `cups`/`goal` + handlers are props. Water queues an ABSOLUTE cups value
 * (last-write-wins) — the container owns that mutation.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <WaterTrackerPresenter>
 */

const PRIMARY = toneHex("primary").base;

export type WaterTrackerProps = {
  cups: number;
  goal: number;
  /** Set the absolute cup count (clamped 0..goal upstream). */
  onSetCups: (cups: number) => void;
  testID?: string;
};

export function WaterTrackerPresenter({
  cups,
  goal,
  onSetCups,
  testID = "fuel-water",
}: WaterTrackerProps) {
  const safeGoal = Math.max(1, goal);
  return (
    <Card pad={16} radius={16} testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        marginBottom={12}
      >
        <View>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            textTransform="uppercase"
            color="$primary"
          >
            Water
          </Text>
          <View flexDirection="row" alignItems="baseline" gap={4} marginTop={4}>
            <Text
              fontFamily="$mono"
              fontSize={20}
              fontWeight="600"
              color="$text"
              fontVariant={["tabular-nums"]}
              testID="fuel-water-count"
            >
              {cups}
            </Text>
            <Text
              fontFamily="$mono"
              fontSize={13}
              color="$text3"
              fontVariant={["tabular-nums"]}
            >
              / {goal} cups
            </Text>
          </View>
        </View>
        <View flexDirection="row" gap={8}>
          <IconBtn
            icon={<IconMinus size={16} strokeWidth={2.5} />}
            tone="neutral"
            onPress={() => onSetCups(Math.max(0, cups - 1))}
            testID="fuel-water-minus"
            accessibilityLabel="Remove a cup of water"
          />
          <IconBtn
            icon={<IconPlus size={16} strokeWidth={2.5} />}
            tone="primary"
            onPress={() => onSetCups(cups + 1)}
            testID="fuel-water-plus"
            accessibilityLabel="Add a cup of water"
          />
        </View>
      </View>
      <View flexDirection="row" gap={4}>
        {Array.from({ length: safeGoal }).map((_, i) => {
          const filled = i < cups;
          return (
            <Pressable
              key={i}
              testID={`fuel-water-cup-${i}`}
              onPress={() => onSetCups(i + 1)}
              accessibilityRole="button"
              accessibilityLabel={`Set water to ${i + 1} cups`}
              style={{ flex: 1 }}
            >
              <View
                height={32}
                borderRadius={6}
                alignItems="center"
                justifyContent="center"
                backgroundColor={filled ? "$primaryDim" : "$surface3"}
                borderWidth={1}
                borderColor={filled ? "$primary" : "$border"}
              >
                <IconDroplet size={14} color={filled ? PRIMARY : "#5C5C68"} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

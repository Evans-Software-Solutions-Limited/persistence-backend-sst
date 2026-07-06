import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
import { Card, IconBtn, Stat } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconDroplet, IconMinus, IconPlus } from "@/ui/components/icons";
import { cupsToLitres } from "@/shared/utils";

/**
 * <WaterTrackerPresenter> — cups grid vs goal (nutrition.jsx:178–214). Tap a cup
 * to set the count to that index+1; +/- step by one CUP (= 0.25 L). Every tap
 * fires a haptic in the container (selectionAsync). Auto-resets at user-local
 * midnight because the day key in `cached_fuel_today` rolls over (upstream).
 *
 * DISPLAY is in LITRES (Brad 2026-07-06: 1 cup = 250 ml = 0.25 L). The
 * count/goal render as "1.5 L / 2.0 L" and each grid cell is a 0.25 L cup. The
 * `cups`/`onSetCups` prop contract stays in CUPS — the wire/storage grain — so
 * the container command still enqueues integer cups; litres is a pure display
 * conversion at this edge (never hardcode 0.25; use `cupsToLitres`).
 *
 * Pure: `cups`/`goal` + handlers are props. Water queues an ABSOLUTE cups value
 * (last-write-wins) — the container owns that mutation.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <WaterTrackerPresenter>
 */

const PRIMARY = toneHex("primary").base;

/**
 * Litres label: 1 dp normally (matches "2.0 L"), 2 dp when a 0.25 L step lands
 * on a non-zero hundredths digit (1.25 L) so the value is never truncated.
 */
function fmtLitres(litres: number): string {
  const twoDp = litres.toFixed(2);
  return twoDp.endsWith("0") ? litres.toFixed(1) : twoDp;
}

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
          <View marginTop={4}>
            <Stat
              value={fmtLitres(cupsToLitres(cups))}
              unit={`/ ${fmtLitres(cupsToLitres(goal))} L`}
              size="md"
              testID="fuel-water-count"
            />
          </View>
        </View>
        <View flexDirection="row" gap={8}>
          <IconBtn
            icon={<IconMinus size={16} strokeWidth={2.5} />}
            tone="neutral"
            onPress={() => onSetCups(Math.max(0, cups - 1))}
            testID="fuel-water-minus"
            accessibilityLabel="Remove 0.25 litres of water"
          />
          <IconBtn
            icon={<IconPlus size={16} strokeWidth={2.5} />}
            tone="primary"
            onPress={() => onSetCups(cups + 1)}
            testID="fuel-water-plus"
            accessibilityLabel="Add 0.25 litres of water"
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
              accessibilityLabel={`Set water to ${fmtLitres(
                cupsToLitres(i + 1),
              )} litres`}
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

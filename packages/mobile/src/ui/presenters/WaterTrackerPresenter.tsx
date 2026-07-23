import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
import { Card, IconBtn, Stat } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconDroplet, IconMinus, IconPlus } from "@/ui/components/icons";
import { cupsToLitres, formatLitres, type VolumeUnit } from "@/shared/utils";

/**
 * <WaterTrackerPresenter> — cups grid vs goal (nutrition.jsx:178–214). Tap a cup
 * to set the count to that index+1; +/- step by one CUP (= 0.25 L). Every tap
 * fires a haptic in the container (selectionAsync). Auto-resets at user-local
 * midnight because the day key in `cached_fuel_today` rolls over (upstream).
 *
 * DISPLAY follows the user's preferred volume unit (device-QA #5/#7,
 * 2026-07-22 — supersedes the earlier always-litres fix): `volumeUnit`
 * defaults to "l" (Brad's locked default), rendering "1.5 / 2.0 L" (1 cup =
 * 250 ml = 0.25 L). An "imperial" preference passes `volumeUnit="cups"`,
 * rendering the raw stored cup count instead. Either way the `cups`/
 * `onSetCups` prop contract, the cup-increment mechanic, and the underlying
 * `water_log.cups` storage grain are UNCHANGED — this is a pure display/label
 * conversion at the render edge (never hardcode 0.25; use `cupsToLitres`).
 *
 * Pure: `cups`/`goal` + handlers are props. Water queues an ABSOLUTE cups value
 * (last-write-wins) — the container owns that mutation.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <WaterTrackerPresenter>
 *             specs/milestones/GO-LIVE-FINAL/BRIEF-7-device-qa-bugs.md § QA-5/QA-7
 */

const PRIMARY = toneHex("primary").base;

export type WaterTrackerProps = {
  cups: number;
  goal: number;
  /** Set the absolute cup count (clamped 0..goal upstream). */
  onSetCups: (cups: number) => void;
  /** Preferred display unit — "l" (default) shows litres; "cups" shows the
   *  stored cup count directly (imperial). Display/label only. */
  volumeUnit?: VolumeUnit;
  testID?: string;
};

export function WaterTrackerPresenter({
  cups,
  goal,
  onSetCups,
  volumeUnit = "l",
  testID = "fuel-water",
}: WaterTrackerProps) {
  const safeGoal = Math.max(1, goal);
  const isCups = volumeUnit === "cups";
  /** Cups value → its display string, in whichever unit is preferred. */
  const fmt = (c: number) =>
    isCups ? String(c) : formatLitres(cupsToLitres(c));
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
              value={fmt(cups)}
              unit={isCups ? `/ ${fmt(goal)} cups` : `/ ${fmt(goal)} L`}
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
            accessibilityLabel={
              isCups ? "Remove 1 cup of water" : "Remove 0.25 litres of water"
            }
          />
          <IconBtn
            icon={<IconPlus size={16} strokeWidth={2.5} />}
            tone="primary"
            onPress={() => onSetCups(cups + 1)}
            testID="fuel-water-plus"
            accessibilityLabel={
              isCups ? "Add 1 cup of water" : "Add 0.25 litres of water"
            }
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
              accessibilityLabel={
                isCups
                  ? `Set water to ${i + 1} cups`
                  : `Set water to ${fmt(i + 1)} litres`
              }
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

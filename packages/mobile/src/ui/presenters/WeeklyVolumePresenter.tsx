import { Text, View } from "@tamagui/core";
import { Card, Stat } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import type { WeeklyVolume } from "@/domain/models/progress";
import { volumeInUnit, type WeightUnit } from "@/shared/utils";

/**
 * <WeeklyVolumePresenter> — Home weekly-volume card (06-progress-goals,
 * STORY-002 AC 2.4; home.jsx:296–338). Stat header (kg total + ▲% vs last week
 * + workouts done/target) over a 7-day vertical bar chart. Today's bar dashed.
 */

export type WeeklyVolumeProps = {
  weeklyVolume: WeeklyVolume;
  /** Display-unit preference for the volume total. Defaults to "kg". */
  weightUnit?: WeightUnit;
  testID?: string;
};

const CHART_HEIGHT = 50;
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const letterFor = (iso: string) =>
  DOW[new Date(`${iso}T00:00:00.000Z`).getUTCDay()] ?? "";

export function WeeklyVolumePresenter({
  weeklyVolume,
  weightUnit = "kg",
  testID = "weekly-volume",
}: WeeklyVolumeProps) {
  const { days, totalKg, deltaPct, workouts } = weeklyVolume;
  const maxKg = days.reduce((m, d) => Math.max(m, d.volumeKg), 0);

  return (
    <Card pad={16} radius={16} testID={testID}>
      <View
        flexDirection="row"
        alignItems="flex-end"
        justifyContent="space-between"
        marginBottom={14}
      >
        <View>
          <Stat
            value={volumeInUnit(totalKg, weightUnit).toLocaleString("en-US")}
            unit={weightUnit}
          />
          {deltaPct != null && (
            <Text fontSize={12} color="$text3" marginTop={2}>
              <Text color={deltaPct >= 0 ? "$success" : "$error"} fontSize={12}>
                {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct)}%
              </Text>{" "}
              vs last week
            </Text>
          )}
        </View>
        <View alignItems="flex-end">
          <Stat
            value={workouts.completed}
            unit={`/${workouts.target}`}
            size="md"
            align="center"
          />
          <Text
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.5}
            color="$text3"
          >
            WORKOUTS
          </Text>
        </View>
      </View>

      <View
        flexDirection="row"
        alignItems="flex-end"
        justifyContent="space-between"
        gap={6}
        height={CHART_HEIGHT + 10}
      >
        {days.map((d) => {
          const frac = maxKg > 0 ? d.volumeKg / maxKg : 0;
          const h = d.isRest ? 4 : Math.max(6, CHART_HEIGHT * frac);
          return (
            <View key={d.date} flex={1} alignItems="center" gap={4}>
              <View
                width="100%"
                height={h}
                borderRadius={4}
                opacity={d.isRest ? 0.5 : 1}
                backgroundColor={
                  d.isToday
                    ? "$primaryDim"
                    : d.isRest
                      ? "$surface3"
                      : "$primary"
                }
                borderWidth={d.isToday ? 1 : 0}
                borderColor={d.isToday ? toneHex("primary").base : undefined}
                borderStyle={d.isToday ? "dashed" : "solid"}
              />
              <Text
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1}
                color={d.isToday ? "$primary" : "$text3"}
              >
                {letterFor(d.date)}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

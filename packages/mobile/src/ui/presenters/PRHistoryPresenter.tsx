import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconMedal } from "@/ui/components/icons";
import {
  isWeightRecordType,
  type PersonalRecord,
  unitForRecordType,
} from "@/domain/models/record";
import { weightInUnit, type WeightUnit } from "@/shared/utils";
import { relativeDate } from "./PRCarouselPresenter";
import {
  activityDistanceFromMeters,
  activityDistanceUnit,
} from "@/shared/utils/activityUnits";

function recordDisplay(
  record: PersonalRecord,
  weightUnit: WeightUnit,
): { value: string | number; unit: string } {
  if (isWeightRecordType(record.recordType)) {
    return { value: weightInUnit(record.value, weightUnit), unit: weightUnit };
  }
  if (record.recordType === "longest_distance") {
    const preferred = weightUnit === "lb" ? "imperial" : "metric";
    return {
      value: activityDistanceFromMeters(record.value, preferred).toFixed(2),
      unit: activityDistanceUnit(preferred),
    };
  }
  if (record.recordType === "best_time") {
    const minutes = Math.floor(record.value / 60);
    const seconds = Math.round(record.value % 60);
    return {
      value: `${minutes}:${seconds.toString().padStart(2, "0")}`,
      unit: "",
    };
  }
  return { value: record.value, unit: unitForRecordType(record.recordType) };
}

/**
 * <PRHistoryPresenter> — You/Progress PR history (06-progress-goals, STORY-003
 * AC 3.6; progress.jsx:227–259). Vertical list of medal rows: lift · date ·
 * weight. (Per-PR delta isn't on the list wire shape — omitted; flagged.)
 */

export type PRHistoryProps = {
  prs: PersonalRecord[];
  /** Display-unit preference for weight-type PR values. Defaults to "kg". */
  weightUnit?: WeightUnit;
  testID?: string;
};

export function PRHistoryPresenter({
  prs,
  weightUnit = "kg",
  testID = "pr-history",
}: PRHistoryProps) {
  return (
    <Card pad={0} radius={14} testID={testID}>
      {prs.map((p, i) => {
        const display = recordDisplay(p, weightUnit);
        return (
          <View
            key={p.id}
            flexDirection="row"
            alignItems="center"
            gap={12}
            paddingVertical={12}
            paddingHorizontal={14}
            borderTopWidth={i ? 1 : 0}
            borderColor="$border"
          >
            <View
              width={32}
              height={32}
              borderRadius={10}
              backgroundColor="$goldDim"
              alignItems="center"
              justifyContent="center"
            >
              <IconMedal size={16} color={toneHex("gold").base} />
            </View>
            <View flex={1}>
              <Text fontSize={13} fontWeight="600" color="$text">
                {p.exerciseName}
              </Text>
              <Text fontSize={11} color="$text3" marginTop={1}>
                {relativeDate(p.achievedAt)}
              </Text>
            </View>
            <View flexDirection="row" alignItems="baseline" gap={3}>
              <Text
                fontFamily="$mono"
                fontSize={20}
                fontWeight="600"
                color="$gold"
              >
                {display.value}
              </Text>
              <Text fontFamily="$mono" fontSize={11} color="$text3">
                {display.unit}
              </Text>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

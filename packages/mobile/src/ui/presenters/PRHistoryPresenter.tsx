import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconMedal } from "@/ui/components/icons";
import { type PersonalRecord, unitForRecordType } from "@/domain/models/record";
import { relativeDate } from "./PRCarouselPresenter";

/**
 * <PRHistoryPresenter> — You/Progress PR history (06-progress-goals, STORY-003
 * AC 3.6; progress.jsx:227–259). Vertical list of medal rows: lift · date ·
 * weight. (Per-PR delta isn't on the list wire shape — omitted; flagged.)
 */

export type PRHistoryProps = {
  prs: PersonalRecord[];
  testID?: string;
};

export function PRHistoryPresenter({
  prs,
  testID = "pr-history",
}: PRHistoryProps) {
  return (
    <Card pad={0} radius={14} testID={testID}>
      {prs.map((p, i) => (
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
              {p.value}
            </Text>
            <Text fontFamily="$mono" fontSize={11} color="$text3">
              {unitForRecordType(p.recordType)}
            </Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

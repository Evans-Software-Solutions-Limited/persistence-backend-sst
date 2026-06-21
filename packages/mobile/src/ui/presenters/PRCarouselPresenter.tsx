import { ScrollView } from "react-native";
import { View } from "@tamagui/core";
import { PRCard } from "@/ui/components/composite";
import { type PersonalRecord, unitForRecordType } from "@/domain/models/record";

/**
 * <PRCarouselPresenter> — Home recent-PRs carousel (06-progress-goals,
 * STORY-002 AC 2.5 / STORY-009; home.jsx:341–372). Horizontal scroll of
 * gold-gradient <PRCard>s.
 */

export type PRCarouselProps = {
  prs: PersonalRecord[];
  testID?: string;
};

/** Coarse relative date ("today" / "3 days ago" / "2 weeks ago"). */
export function relativeDate(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((now - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
}

export function PRCarouselPresenter({
  prs,
  testID = "pr-carousel",
}: PRCarouselProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      testID={testID}
      contentContainerStyle={{ gap: 10, paddingRight: 16 }}
    >
      {prs.map((pr) => (
        <View key={pr.id}>
          <PRCard
            exerciseName={pr.exerciseName}
            value={pr.value}
            unit={unitForRecordType(pr.recordType)}
            date={relativeDate(pr.achievedAt)}
          />
        </View>
      ))}
    </ScrollView>
  );
}

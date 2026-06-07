import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { HabitTile, type HabitTone } from "@/ui/components/composite";

/**
 * <HabitsGridPresenter> — Home 7-day habit grid (06-progress-goals, STORY-004;
 * home.jsx:227–268). Each cell is a <HabitTile> (per design.md § HabitsGrid).
 * `weekDates` is 7 YYYY-MM-DD, today last; tapping a cell toggles that day.
 *
 * NB vs prototype: the prototype draws a denser 18px custom grid; design.md
 * mandates <HabitTile> (36px, with done/today/missed/locked states + tones).
 * Followed the spec — flag the cell density for the on-device fidelity pass.
 */

export type HabitVM = {
  id: string; // goalId
  label: string;
  tone: HabitTone;
  days: boolean[]; // length 7, today last
};

export type HabitsGridProps = {
  habits: HabitVM[];
  weekDates: string[]; // 7 YYYY-MM-DD, today last
  onToggle: (goalId: string, day: string, done: boolean) => void;
  testID?: string;
};

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const letterFor = (iso: string) =>
  DOW[new Date(`${iso}T00:00:00.000Z`).getUTCDay()] ?? "";

export function HabitsGridPresenter({
  habits,
  weekDates,
  onToggle,
  testID = "habits-grid",
}: HabitsGridProps) {
  return (
    <Card pad={14} radius={16} testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        marginBottom={10}
        paddingHorizontal={4}
      >
        <Text fontSize={13} fontWeight="600" color="$text2">
          Habits
        </Text>
        <View flexDirection="row" gap={8}>
          {weekDates.map((iso, i) => (
            <Text
              key={iso}
              width={36}
              textAlign="center"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1}
              color={i === 6 ? "$primary" : "$text3"}
            >
              {letterFor(iso)}
            </Text>
          ))}
        </View>
      </View>

      {habits.map((h) => (
        <View
          key={h.id}
          flexDirection="row"
          alignItems="center"
          paddingVertical={4}
          paddingHorizontal={4}
          borderTopWidth={1}
          borderColor="$border"
        >
          <Text flex={1} fontSize={13} fontWeight="500" color="$text">
            {h.label}
          </Text>
          <View flexDirection="row" gap={8}>
            {h.days.map((done, i) => {
              const isToday = i === 6;
              const state = done ? "done" : isToday ? "today" : "missed";
              return (
                <HabitTile
                  key={weekDates[i]}
                  state={state}
                  tone={h.tone}
                  onPress={() => onToggle(h.id, weekDates[i], !done)}
                  accessibilityLabel={`${h.label} ${weekDates[i]} ${
                    done ? "done" : "not done"
                  }`}
                />
              );
            })}
          </View>
        </View>
      ))}
    </Card>
  );
}

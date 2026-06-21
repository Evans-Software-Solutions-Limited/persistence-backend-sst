import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { HabitTile, type HabitTone } from "@/ui/components/composite";
import { localDayISO } from "@/shared/utils";

/**
 * <HabitsGridPresenter> — Home Mon→Sun habit grid (06-progress-goals,
 * STORY-004; home.jsx:227–268). Dense 18pt <HabitTile> cells. `weekDates` is
 * the 7 YYYY-MM-DD of the current week, Monday-first; tapping a cell toggles
 * that day. Today is highlighted wherever it falls; days after today are locked
 * (upcoming), days before today without a completion read as missed.
 */

export type HabitVM = {
  id: string; // goalId
  label: string;
  tone: HabitTone;
  days: boolean[]; // length 7, Mon→Sun (aligns with weekDates)
};

export type HabitsGridProps = {
  habits: HabitVM[];
  weekDates: string[]; // 7 YYYY-MM-DD, Monday-first
  onToggle: (goalId: string, day: string, done: boolean) => void;
  testID?: string;
};

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const letterFor = (iso: string) =>
  DOW[new Date(`${iso}T00:00:00.000Z`).getUTCDay()] ?? "";

// Dense, prototype-style cell (home.jsx HabitsGrid ≈ 18pt squares), not the
// 36pt design-system default. Header letters share the width so columns align.
const CELL = 18;

export function HabitsGridPresenter({
  habits,
  weekDates,
  onToggle,
  testID = "habits-grid",
}: HabitsGridProps) {
  const todayISO = localDayISO();
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
          {weekDates.map((iso) => (
            <Text
              key={iso}
              width={CELL}
              textAlign="center"
              fontSize={10}
              fontWeight="600"
              letterSpacing={0.5}
              color={iso === todayISO ? "$primary" : "$text3"}
            >
              {letterFor(iso)}
            </Text>
          ))}
        </View>
      </View>

      {habits.length === 0 ? (
        // Simple prompt — the habit-setup page (Water / Gym / Sleep / Calories
        // categories + streak definition) is a follow-up; this links into it.
        <View
          paddingTop={16}
          paddingBottom={8}
          alignItems="center"
          borderTopWidth={1}
          borderColor="$border"
          testID="habits-grid-empty"
        >
          <Text fontSize={13} fontWeight="600" color="$primary">
            Get started by setting your habits
          </Text>
        </View>
      ) : null}

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
              const iso = weekDates[i];
              // YYYY-MM-DD compares lexicographically = chronologically.
              const isToday = iso === todayISO;
              const isFuture = iso > todayISO;
              const state = done
                ? "done"
                : isToday
                  ? "today"
                  : isFuture
                    ? "locked" // upcoming day this week — not "missed"
                    : "missed";
              return (
                <HabitTile
                  key={weekDates[i]}
                  state={state}
                  tone={h.tone}
                  size={CELL}
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

import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
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
  /**
   * The value a completion for this habit must carry (regression fix — the
   * backend 422s a value_gte/within_tolerance completion with none). Threaded
   * through so `onToggle` can send it; `undefined`/`null` for a habit that
   * doesn't require one (Gym).
   */
  targetValue?: number | null;
  /**
   * False for Calories: the backend scores it from `nutrition_entries`, never
   * `habit_completions`, so a completion row here is inert. Defaults to true.
   */
  toggleable?: boolean;
};

export type HabitsGridProps = {
  habits: HabitVM[];
  weekDates: string[]; // 7 YYYY-MM-DD, Monday-first
  onToggle: (
    goalId: string,
    day: string,
    done: boolean,
    value?: number | null,
  ) => void;
  /**
   * Navigate to the habit-setup screen (18-habit-setup STORY-007). Drives the
   * empty-state CTA and the persistent "Manage" affordance in the header. When
   * omitted the affordances render as plain (non-pressable) text — keeps older
   * callers that predate the setup screen unbroken.
   */
  onManageHabits?: () => void;
  /**
   * A non-toggleable habit's row (Calories) deep-links here instead of
   * toggling — mirrors `HabitCardPresenter`'s Calories deep-link to Fuel
   * Targets. Required when any habit has `toggleable === false`; the row is
   * still tappable without it, just inert.
   */
  onOpenNonToggleable?: (goalId: string) => void;
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
  onManageHabits,
  onOpenNonToggleable,
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
        <View flexDirection="row" alignItems="center" gap={8}>
          <Text fontSize={13} fontWeight="600" color="$text2">
            Habits
          </Text>
          {/* Persistent "Manage" affordance once habits exist (STORY-007 7.2). */}
          {onManageHabits && habits.length > 0 ? (
            <Pressable
              onPress={onManageHabits}
              accessibilityRole="button"
              accessibilityLabel="Manage habits"
              hitSlop={8}
              testID="habits-grid-manage"
            >
              <Text fontSize={11} fontWeight="600" color="$primary">
                Manage
              </Text>
            </Pressable>
          ) : null}
        </View>
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
        // Empty-state CTA → the habit-setup screen (18-habit-setup STORY-007
        // 7.1). Pressable when a handler is wired; plain text otherwise.
        <Pressable
          onPress={onManageHabits}
          disabled={!onManageHabits}
          accessibilityRole={onManageHabits ? "button" : undefined}
          accessibilityLabel={
            onManageHabits ? "Get started by setting your habits" : undefined
          }
          style={({ pressed }) => ({
            opacity: pressed && onManageHabits ? 0.7 : 1,
          })}
          testID="habits-grid-empty"
        >
          <View
            paddingTop={16}
            paddingBottom={8}
            alignItems="center"
            borderTopWidth={1}
            borderColor="$border"
          >
            <Text fontSize={13} fontWeight="600" color="$primary">
              Get started by setting your habits
            </Text>
          </View>
        </Pressable>
      ) : null}

      {habits.map((h) => {
        // Regression fix: Calories can't be meaningfully toggled from this
        // grid (the engine scores it from nutrition_entries, not
        // habit_completions) — its row renders read-only, deep-linking to
        // Fuel on tap instead of flipping a cell.
        const toggleable = h.toggleable ?? true;
        return (
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
                    onPress={() =>
                      toggleable
                        ? onToggle(h.id, weekDates[i], !done, h.targetValue)
                        : onOpenNonToggleable?.(h.id)
                    }
                    accessibilityLabel={
                      toggleable
                        ? `${h.label} ${weekDates[i]} ${
                            done ? "done" : "not done"
                          }`
                        : `${h.label} — set in Fuel`
                    }
                  />
                );
              })}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

import { Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { ScreenGlow } from "@/ui/components/foundation/ScreenGlow";
import { IconChevronL, IconChevronR } from "@/ui/components/icons";
import { MuscleMap } from "@/ui/components/summary/MuscleMap";
import type { BodyMapShading, CalendarCell } from "@/domain/services/youPage";
import { color } from "@/ui/theme/tokens";
import { Eyebrow, IconButton, KeyValueRow, TopBar } from "./you/youKit";

/**
 * <HistoryPresenter> — Y2 History (PER-141, note `yn1`): a month calendar
 * where a day is a filled cyan circle when anything was logged; tapping a
 * day rings it and its breakdown renders below on the same screen —
 * muscles worked across all that day's workouts (plain grey on a rest day),
 * the day's workouts (each opens the Y2b summary carousel), then calories,
 * steps, weight, water and sleep. Pure.
 */

export type HistoryWorkoutRow = {
  id: string;
  time: string;
  name: string;
  detail: string;
  accessibilityLabel: string;
};

export type HistoryDayView = {
  key: string;
  /** "Mon 26 October" */
  title: string;
  /** "Training day" · "Rest day" · "Nothing logged" */
  status: string;
  trained: boolean;
  shading: BodyMapShading;
  gender: "male" | "female";
  /** "Chest, back, shoulders" or "Nothing trained" */
  musclesText: string;
  /** "2 workouts · 73 min · 7.6 t" or "Rest day" */
  summary: string;
  /** "2 workouts" or "Workout" */
  workoutsTitle: string;
  workouts: readonly HistoryWorkoutRow[];
  values: readonly { label: string; value: string; good?: boolean }[];
};

export type HistoryPresenterProps = {
  /** "October 2026" */
  monthTitle: string;
  cells: readonly CalendarCell[];
  selectedKey: string;
  canGoNext: boolean;
  /**
   * Set when the month starts before this phone's training log and BE-H1
   * (PER-113) can't fill it yet: the month may be missing workouts.
   */
  coverageNote: string | null;
  day: HistoryDayView;
  onBack(): void;
  onPrevMonth(): void;
  onNextMonth(): void;
  onSelectDay(key: string): void;
  onOpenWorkout(id: string): void;
};

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function HistoryPresenter(p: HistoryPresenterProps) {
  const insets = useSafeAreaInsets();
  const d = p.day;
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="history-screen"
    >
      <ScreenGlow />
      <TopBar
        left={
          <IconButton label="Back" onPress={p.onBack} testID="history-back">
            <IconChevronL size={20} color={color.$text} />
          </IconButton>
        }
        title="History"
        right={<View width={44} />}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
      >
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={18}
            color="$text"
          >
            {p.monthTitle}
          </Text>
          <View flexDirection="row" gap={6}>
            <IconButton
              label="Previous month"
              onPress={p.onPrevMonth}
              size={36}
              testID="history-prev"
            >
              <IconChevronL size={16} color={color.$text} />
            </IconButton>
            <View opacity={p.canGoNext ? 1 : 0.35}>
              <IconButton
                label="Next month"
                onPress={() => p.canGoNext && p.onNextMonth()}
                size={36}
                testID="history-next"
              >
                <IconChevronR size={16} color={color.$text} />
              </IconButton>
            </View>
          </View>
        </View>

        <View
          flexDirection="row"
          flexWrap="wrap"
          marginTop={6}
          accessibilityLabel="Days with something logged"
          testID="history-calendar"
        >
          {WEEKDAYS.map((w, i) => (
            <Text
              key={`h${i}`}
              width="14.2857%"
              textAlign="center"
              paddingBottom={4}
              fontFamily="$display"
              fontWeight="600"
              fontSize={10}
              lineHeight={14}
              letterSpacing={1.4}
              color="$text3"
            >
              {w}
            </Text>
          ))}
          {p.cells.map((c, i) => (
            <DayCell
              key={c.key ?? `pad${i}`}
              cell={c}
              selected={c.key === p.selectedKey}
              monthTitle={p.monthTitle}
              onPress={p.onSelectDay}
            />
          ))}
        </View>
        {!!p.coverageNote && (
          <Text
            fontFamily="$body"
            fontSize={12}
            lineHeight={17}
            color="$text3"
            marginTop={6}
            testID="history-coverage"
          >
            {p.coverageNote}
          </Text>
        )}

        <View
          borderTopWidth={1}
          borderColor="rgba(255,255,255,0.08)"
          marginTop={8}
          paddingTop={12}
          accessibilityLiveRegion="polite"
          testID={`history-day-${d.key}`}
        >
          <View
            flexDirection="row"
            justifyContent="space-between"
            alignItems="baseline"
          >
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={18}
              color="$text"
            >
              {d.title}
            </Text>
            <Text
              fontFamily="$display"
              fontWeight="500"
              fontSize={12}
              color="$text3"
              testID="history-day-status"
            >
              {d.status}
            </Text>
          </View>
          <View flexDirection="row" gap={12} alignItems="center" marginTop={8}>
            <View opacity={d.trained ? 1 : 0.7}>
              <MuscleMap
                muscles={d.shading}
                height={128}
                gap={0}
                gender={d.gender}
                testID="history-muscle-map"
              />
            </View>
            <View flex={1}>
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={10}
                lineHeight={14}
                letterSpacing={2.6}
                textTransform="uppercase"
                color="$text3"
              >
                Muscles worked
              </Text>
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={14}
                lineHeight={19}
                color="$text"
              >
                {d.musclesText}
              </Text>
              <Text
                fontFamily="$mono"
                fontSize={12}
                color="$text3"
                marginTop={2}
              >
                {d.summary}
              </Text>
            </View>
          </View>

          {d.trained && (
            <View>
              <Eyebrow marginTop={10}>{d.workoutsTitle}</Eyebrow>
              {d.workouts.map((w) => (
                <Pressable
                  key={w.id}
                  onPress={() => p.onOpenWorkout(w.id)}
                  accessibilityRole="button"
                  accessibilityLabel={w.accessibilityLabel}
                  testID={`history-workout-${w.id}`}
                >
                  <View
                    flexDirection="row"
                    alignItems="center"
                    gap={12}
                    paddingVertical={10}
                    borderBottomWidth={1}
                    borderColor="rgba(255,255,255,0.07)"
                  >
                    <Text
                      width={42}
                      fontFamily="$mono"
                      fontSize={12}
                      color="$text3"
                    >
                      {w.time}
                    </Text>
                    <View flex={1} minWidth={0} gap={2}>
                      <Text
                        fontFamily="$display"
                        fontWeight="600"
                        fontSize={15}
                        lineHeight={20}
                        color="$text"
                        numberOfLines={1}
                      >
                        {w.name}
                      </Text>
                      <Text
                        fontFamily="$mono"
                        fontSize={12}
                        lineHeight={16}
                        color="$text3"
                      >
                        {w.detail}
                      </Text>
                    </View>
                    <IconChevronR size={16} color={color.$text4} />
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          <View marginTop={6}>
            {d.values.map((v) => (
              <KeyValueRow
                key={v.label}
                label={v.label}
                value={v.value}
                good={v.good}
                testID={`history-value-${v.label.toLowerCase()}`}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function DayCell(p: {
  cell: CalendarCell;
  selected: boolean;
  monthTitle: string;
  onPress(key: string): void;
}) {
  const c = p.cell;
  if (c.day == null) return <View width="14.2857%" height={44} />;
  const textColor = c.logged
    ? "$primaryInk"
    : c.future
      ? "$surface5"
      : "$text3";
  return (
    <Pressable
      style={{
        width: "14.2857%",
        height: 44,
        alignItems: "center",
        justifyContent: "center",
      }}
      onPress={() => !c.future && p.onPress(c.key!)}
      disabled={c.future}
      accessibilityRole="button"
      accessibilityState={{ selected: p.selected, disabled: c.future }}
      accessibilityLabel={`${c.day} ${p.monthTitle.split(" ")[0]}, ${c.logged ? "logged" : "nothing logged"}`}
      testID={`history-cell-${c.key}`}
    >
      <View
        width={44}
        height={44}
        borderRadius={999}
        borderWidth={2}
        borderColor={p.selected ? "$primary" : "transparent"}
        alignItems="center"
        justifyContent="center"
      >
        <View
          width={36}
          height={36}
          borderRadius={999}
          backgroundColor={c.logged ? "$primary" : "transparent"}
          alignItems="center"
          justifyContent="center"
        >
          <Text
            fontFamily="$mono"
            fontWeight="600"
            fontSize={13}
            color={textColor}
          >
            {c.day}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

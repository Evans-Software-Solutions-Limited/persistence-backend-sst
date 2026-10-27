/**
 * WorkoutDetailsPresenter — one finished workout in full (PER-60 canvas
 * row 3c, `Summary.dc.html` phones 12–13). Its own screen, scrolling down
 * only: the totals strip, then per exercise a Set / Weight / Reps / 1RM /
 * Vol table with notes inline, record sets in gold with ★ and a total.
 *
 * Takes the same `WorkoutSummaryModel` as the finish pages, so a past
 * workout in history can open it unchanged.
 */

import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import {
  muscleShare,
  type WorkoutSummaryModel,
} from "@/domain/services/workoutSummary";
import { weightInUnit, type WeightUnit } from "@/shared/utils";
import { ScreenGlow } from "@/ui/components/foundation/ScreenGlow";
import { IconChevronL, IconShareUp } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import { tint } from "@/ui/theme/tint";
import { RoundButton } from "./SessionSummaryPresenter";
import {
  clock,
  distanceText,
  shortDate,
  summaryShareText,
  volumeText,
  weightText,
} from "./summaryFormat";
import { getDifficultyMessage } from "./WorkoutRatingPresenter";

export type WorkoutDetailsPresenterProps = {
  model: WorkoutSummaryModel;
  recordsCount: number;
  rating: number | null;
  /** Training partners' names for a Together workout. */
  partners?: readonly string[];
  weightUnit?: WeightUnit;
  onBack(): void;
  /** Shares the whole workout as text (`summaryShareText`). */
  onShare(text: string): void;
};

const COLUMNS = [34, 1.2, 0.8, 0.8, 1] as const;
const NO_MUSCLES = muscleShare([]);

export function WorkoutDetailsPresenter(p: WorkoutDetailsPresenterProps) {
  const insets = useSafeAreaInsets();
  const unit = p.weightUnit ?? "kg";
  const m = p.model;
  const meta = [
    clock(m.durationSeconds),
    shortDate(m.startedAt),
    p.rating != null
      ? `${getDifficultyMessage(p.rating)} ${p.rating}/10`
      : null,
    p.partners?.length ? `with ${p.partners.join(", ")}` : null,
  ].filter(Boolean);
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="workout-details-screen"
    >
      <ScreenGlow />
      <View
        flexDirection="row"
        justifyContent="space-between"
        paddingHorizontal={16}
      >
        <RoundButton
          label="Back to summary"
          onPress={p.onBack}
          testID="workout-details-back"
        >
          <IconChevronL size={20} color={color.$text} />
        </RoundButton>
        <RoundButton
          label="Share workout"
          onPress={() =>
            p.onShare(
              summaryShareText("details", {
                model: m,
                muscles: NO_MUSCLES,
                records: [],
                rating: p.rating,
                unit,
              }),
            )
          }
          testID="workout-details-share"
        >
          <IconShareUp size={20} color={color.$text} />
        </RoundButton>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        horizontal={false}
        showsHorizontalScrollIndicator={false}
        testID="workout-details-scroll"
      >
        <Text
          marginTop={16}
          fontFamily="$display"
          fontWeight="800"
          fontSize={34}
          lineHeight={40}
          letterSpacing={-1}
          color="$text"
          accessibilityRole="header"
        >
          {m.name}
        </Text>
        <Text
          marginTop={8}
          fontFamily="$mono"
          fontSize={14}
          lineHeight={18}
          color="$text3"
        >
          {meta.join(" · ")}
        </Text>
        <View
          flexDirection="row"
          marginTop={22}
          paddingVertical={16}
          borderTopWidth={1}
          borderBottomWidth={1}
          borderColor="$border2"
        >
          {[
            { label: "Sets", value: String(m.sets) },
            { label: "Volume", value: volumeText(m.volumeKg, unit), unit },
            { label: "Reps", value: String(m.reps) },
            { label: "Records", value: String(p.recordsCount), gold: true },
          ].map((s, i) => (
            <View
              key={s.label}
              flex={1}
              gap={4}
              paddingLeft={i ? 12 : 0}
              borderLeftWidth={i ? 1 : 0}
              borderColor="$border2"
            >
              <Text
                fontFamily="$mono"
                fontWeight="700"
                fontSize={22}
                lineHeight={26}
                letterSpacing={-0.5}
                color={s.gold ? "$gold" : "$text"}
                numberOfLines={1}
              >
                {s.value}
                {s.unit ? (
                  <Text
                    fontFamily="$mono"
                    fontWeight="500"
                    fontSize={12}
                    lineHeight={14}
                    color="$text3"
                  >
                    {` ${s.unit}`}
                  </Text>
                ) : null}
              </Text>
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={10.5}
                lineHeight={14}
                letterSpacing={1.6}
                textTransform="uppercase"
                color="$text3"
              >
                {s.label}
              </Text>
            </View>
          ))}
        </View>
        {m.exercises.map((e) => (
          <View
            key={e.id}
            marginTop={12}
            padding={16}
            borderRadius={18}
            borderWidth={1}
            borderColor="$border"
            style={{ backgroundColor: tint(color.$surface, 0.85) }}
            testID={`workout-details-exercise-${e.id}`}
          >
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={16}
              lineHeight={22}
              color="$text"
            >
              {e.name}
            </Text>
            {e.notes && (
              <Text
                marginTop={4}
                fontFamily="$body"
                fontStyle="italic"
                fontSize={13}
                lineHeight={18}
                color="$text3"
              >
                {e.notes}
              </Text>
            )}
            <View marginTop={8}>
              {isTimed(e) ? (
                <TimedSets exercise={e} unit={unit} />
              ) : (
                <>
                  <Row header cells={["Set", "Weight", "Reps", "1RM", "Vol"]} />
                  {e.sets.map((s) => (
                    <Row
                      key={s.id}
                      record={s.isRecord}
                      cells={[
                        String(s.n),
                        s.weightKg != null
                          ? `${weightText(s.weightKg, unit)} ${unit}${s.isRecord ? " ★" : ""}`
                          : "—",
                        s.reps != null ? String(s.reps) : "—",
                        s.oneRepMaxKg != null
                          ? String(
                              Math.round(weightInUnit(s.oneRepMaxKg, unit)),
                            )
                          : "—",
                        volumeText(s.volumeKg, unit),
                      ]}
                    />
                  ))}
                </>
              )}
            </View>
            <Text
              marginTop={10}
              textAlign="right"
              fontFamily="$mono"
              fontWeight="700"
              fontSize={14}
              lineHeight={18}
              color="$text"
            >
              {isTimed(e)
                ? exerciseDistance(e, unit)
                : `${volumeText(e.volumeKg, unit)} ${unit}`}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

type DetailsExercise = WorkoutSummaryModel["exercises"][number];

/** A run or a row: no set has weight or reps, so time and distance stand in. */
const isTimed = (e: DetailsExercise) =>
  e.sets.every((s) => s.weightKg == null && s.reps == null);

/** The total distance, or the total time when nothing was measured. */
function exerciseDistance(e: DetailsExercise, unit: WeightUnit) {
  const meters = e.sets.reduce((n, s) => n + (s.distanceMeters ?? 0), 0);
  if (meters) return distanceText(meters, unit);
  return clock(e.sets.reduce((n, s) => n + (s.durationSeconds ?? 0), 0));
}

function TimedSets(p: { exercise: DetailsExercise; unit: WeightUnit }) {
  return (
    <>
      <Row header cells={["Set", "Time", "Distance"]} />
      {p.exercise.sets.map((s) => (
        <Row
          key={s.id}
          cells={[
            String(s.n),
            s.durationSeconds != null ? clock(s.durationSeconds) : "—",
            s.distanceMeters != null
              ? distanceText(s.distanceMeters, p.unit)
              : "—",
          ]}
        />
      ))}
    </>
  );
}

function Row(p: { cells: string[]; header?: boolean; record?: boolean }) {
  return (
    <View
      flexDirection="row"
      gap={6}
      accessibilityRole={p.header ? "header" : undefined}
    >
      {p.cells.map((cell, i) => (
        <View
          key={i}
          {...(i === 0 ? { width: COLUMNS[0] } : { flex: COLUMNS[i] })}
          paddingVertical={p.header ? 8 : 9}
          borderBottomWidth={1}
          borderColor="$border"
        >
          <Text
            fontFamily={p.header ? "$body" : "$mono"}
            fontSize={p.header ? 12 : 14}
            lineHeight={p.header ? 16 : 20}
            fontWeight={p.record && i === 1 ? "700" : "400"}
            color={
              p.header ? "$text3" : p.record && i === 1 ? "$gold" : "$text"
            }
            numberOfLines={1}
          >
            {cell}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
});

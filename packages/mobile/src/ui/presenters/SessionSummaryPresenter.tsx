/**
 * SessionSummaryPresenter — the finish pages (PER-60 canvas row 3c,
 * `Summary.dc.html` phones 6–11, note `n3b_cards`).
 *
 * Up to six full-screen pages that swipe sideways only and never scroll
 * down: Totals, Muscles worked, Exercises (six rows), Volume by exercise
 * (top five), Personal records (hero for one, a list of three for more)
 * and Trained together (Together sessions only). A page with no data is
 * not shown. Under the pages: dots, then Workout details and Continue.
 * Share (top right on the canvas) needs a native build and lands later.
 */

import { useRef, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import Carousel, {
  type ICarouselInstance,
} from "react-native-reanimated-carousel";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Path, Svg } from "react-native-svg";
import { Text, View } from "@tamagui/core";
import type {
  MuscleShare,
  SummaryPage,
  SummaryRecord,
  WorkoutSummaryModel,
} from "@/domain/services/workoutSummary";
import { summaryPages } from "@/domain/services/workoutSummary";
import type { WeightUnit } from "@/shared/utils";
import {
  activityDistanceFromMeters,
  activityDistanceUnit,
} from "@/shared/utils/activityUnits";
import { ScreenGlow } from "@/ui/components/foundation/ScreenGlow";
import { IconMedal, IconX } from "@/ui/components/icons";
import { MuscleMap } from "@/ui/components/summary/MuscleMap";
import { color } from "@/ui/theme/tokens";
import { tint } from "@/ui/theme/tint";
import {
  RECORD_LABEL,
  listNames,
  minutes,
  recordText,
  recordValue,
  shortDate,
  volumeText,
} from "./summaryFormat";
import {
  togetherToneColor,
  TOGETHER_PARTNER_TONES,
} from "./TogetherAthleteAvatar";
import { TogetherBtn } from "./TogetherBtn";
import {
  getDifficultyColor,
  getDifficultyMessage,
} from "./WorkoutRatingPresenter";

export type SummaryTogether = {
  /** The athlete's own name, for their face. */
  self: string;
  /** Everyone else in the session, in seat order. */
  names: readonly string[];
  connection: "Nearby" | "Online";
};

export type SessionSummaryPresenterProps = {
  model: WorkoutSummaryModel;
  muscles: MuscleShare;
  /** Server records only; empty until the response lands. */
  records: readonly SummaryRecord[];
  workoutsThisMonth: number | null;
  /** The 1–10 effort from the rating screen. */
  rating: number | null;
  weightUnit?: WeightUnit;
  together?: SummaryTogether | null;
  initialPage?: number;
  onDetails(): void;
  onContinue(): void;
  onClose(): void;
};

const PAGE_TITLE: Record<SummaryPage, string> = {
  totals: "Totals",
  muscles: "Muscles worked",
  exercises: "Exercises",
  volume: "Volume by exercise",
  records: "Personal records",
  together: "Trained together",
};

const MAX_EXERCISES = 6;
const MAX_VOLUME = 5;
const MAX_RECORDS = 3;

export function SessionSummaryPresenter(p: SessionSummaryPresenterProps) {
  const insets = useSafeAreaInsets();
  const pages = summaryPages({
    muscles: p.muscles,
    model: p.model,
    records: p.records,
    together: !!p.together?.names.length,
  });
  const [index, setIndex] = useState(
    Math.min(p.initialPage ?? 0, pages.length - 1),
  );
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const carousel = useRef<ICarouselInstance>(null);
  const current = Math.min(index, pages.length - 1);
  const go = (i: number) => {
    setIndex(i);
    carousel.current?.scrollTo({ index: i, animated: true });
  };
  const unit = p.weightUnit ?? "kg";

  const page = (kind: SummaryPage, i: number) => (
    <Pressable
      onPress={() => go((i + 1) % pages.length)}
      accessibilityRole="button"
      accessibilityLabel={`${PAGE_TITLE[kind]}, page ${i + 1} of ${pages.length}`}
      accessibilityHint="Swipe sideways for the other pages"
      style={styles.page}
      testID={`summary-page-${kind}`}
    >
      {kind === "totals" ? (
        <Totals {...p} unit={unit} />
      ) : kind === "muscles" ? (
        <Muscles muscles={p.muscles} />
      ) : kind === "exercises" ? (
        <Exercises model={p.model} onDetails={p.onDetails} />
      ) : kind === "volume" ? (
        <Volume model={p.model} unit={unit} onDetails={p.onDetails} />
      ) : kind === "records" ? (
        <Records records={p.records} unit={unit} onDetails={p.onDetails} />
      ) : (
        <Together model={p.model} together={p.together!} />
      )}
    </Pressable>
  );

  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="session-summary-screen"
    >
      <ScreenGlow />
      <View
        flexDirection="row"
        justifyContent="space-between"
        paddingHorizontal={16}
      >
        <RoundButton
          label="Close summary"
          onPress={p.onClose}
          testID="session-summary-close"
        >
          <IconX size={20} color={color.$text} />
        </RoundButton>
      </View>
      <View
        flex={1}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width && height) setSize({ width, height });
        }}
        testID="summary-pages"
      >
        {size && (
          <Carousel
            ref={carousel}
            width={size.width}
            height={size.height}
            data={pages}
            loop={false}
            defaultIndex={current}
            onSnapToItem={setIndex}
            onConfigurePanGesture={(g) => {
              // Sideways only: a vertical drag never moves the pages.
              g.activeOffsetX([-10, 10]);
            }}
            renderItem={({ item, index: i }) => page(item, i)}
          />
        )}
      </View>
      <View paddingTop={14} paddingHorizontal={20} paddingBottom={30} gap={16}>
        <View
          flexDirection="row"
          justifyContent="center"
          accessibilityRole="tablist"
          accessibilityLabel="Summary pages"
        >
          {pages.map((kind, i) => (
            <Pressable
              key={kind}
              onPress={() => go(i)}
              accessibilityRole="tab"
              accessibilityLabel={PAGE_TITLE[kind]}
              accessibilityState={{ selected: i === current }}
              style={styles.dotHit}
              testID={`summary-dot-${kind}`}
            >
              <View
                height={8}
                width={i === current ? 24 : 8}
                borderRadius={999}
                backgroundColor={i === current ? "$text" : "$surface5"}
              />
            </Pressable>
          ))}
        </View>
        <View flexDirection="row" gap={10}>
          <View flex={1}>
            <OutlineBtn onPress={p.onDetails} testID="summary-details">
              Workout details
            </OutlineBtn>
          </View>
          <View flex={1}>
            <TogetherBtn onPress={p.onContinue} testID="summary-continue">
              Continue
            </TogetherBtn>
          </View>
        </View>
      </View>
    </View>
  );
}

/** Canvas `.ibtn`: a 44pt round icon button on a faint fill. */
export function RoundButton(p: {
  label: string;
  onPress(): void;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={p.label}
      testID={p.testID}
    >
      <View
        width={44}
        height={44}
        borderRadius={999}
        backgroundColor="$border"
        borderWidth={1}
        borderColor="$border2"
        alignItems="center"
        justifyContent="center"
      >
        {p.children}
      </View>
    </Pressable>
  );
}

/** Canvas `.btn.outline` on the summary: a hairline, not the primary ring. */
function OutlineBtn(p: { children: string; onPress(): void; testID?: string }) {
  return (
    <Pressable onPress={p.onPress} accessibilityRole="button" testID={p.testID}>
      <View
        height={52}
        borderRadius={14}
        borderWidth={1}
        borderColor="$border3"
        alignItems="center"
        justifyContent="center"
      >
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={15}
          lineHeight={18}
          color="$text"
        >
          {p.children}
        </Text>
      </View>
    </Pressable>
  );
}

/** Canvas `.brand`: the P mark and "Persistence". */
function Brand({ left }: { left?: boolean }) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={6}
      justifyContent={left ? "flex-start" : "center"}
    >
      <Svg width={16} height={16} viewBox="0 0 24 24">
        <Path
          d="M6 20V4h7a5 5 0 0 1 0 10H6"
          fill="none"
          stroke={color.$primary}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text
        fontFamily="$display"
        fontWeight="600"
        fontSize={13}
        lineHeight={16}
        color="$text2"
      >
        Persistence
      </Text>
    </View>
  );
}

/** Canvas `.trk`: wide-tracked uppercase line. */
function Track(p: {
  children: string;
  marginTop: number;
  gold?: boolean;
  left?: boolean;
}) {
  return (
    <Text
      marginTop={p.marginTop}
      fontFamily="$display"
      fontWeight="600"
      fontSize={12}
      lineHeight={16}
      letterSpacing={3.2}
      textTransform="uppercase"
      textAlign={p.left ? "left" : "center"}
      color={p.gold ? "$gold" : "$text2"}
    >
      {p.children}
    </Text>
  );
}

/** Canvas `.big` + `.unit`. */
function Big(p: {
  value: string;
  unit: string;
  gold?: boolean;
  marginTop: number;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="baseline"
      justifyContent="center"
      gap={8}
      marginTop={p.marginTop}
    >
      <Text
        fontFamily="$mono"
        fontWeight="700"
        fontSize={84}
        lineHeight={88}
        letterSpacing={-4}
        color={p.gold ? "$gold" : "$text"}
        style={
          p.gold
            ? {
                textShadowColor: tint(color.$gold, 0.3),
                textShadowRadius: 28,
              }
            : undefined
        }
      >
        {p.value}
      </Text>
      {!!p.unit && (
        <Text
          fontFamily="$mono"
          fontWeight="500"
          fontSize={22}
          lineHeight={26}
          color={p.gold ? "$gold" : "$text3"}
        >
          {p.unit}
        </Text>
      )}
    </View>
  );
}

/** Canvas `.trio`: three centred figures. */
function Trio(p: {
  items: { value: string; label: string }[];
  marginTop: number;
}) {
  return (
    <View flexDirection="row" alignSelf="stretch" marginTop={p.marginTop}>
      {p.items.map((item) => (
        <View key={item.label} flex={1} alignItems="center" gap={4}>
          <Text
            fontFamily="$mono"
            fontWeight="700"
            fontSize={26}
            lineHeight={30}
            color="$text"
          >
            {item.value}
          </Text>
          <Text
            fontFamily="$body"
            fontSize={13}
            lineHeight={18}
            color="$text3"
            textAlign="center"
          >
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Canvas `.more`: the rest live in Workout details. */
function More(p: { count: number; onPress(): void }) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="link"
      hitSlop={{ top: 13, bottom: 13 }}
      style={{ marginTop: 12, alignSelf: "flex-start" }}
    >
      <Text
        fontFamily="$body"
        fontWeight="500"
        fontSize={13}
        lineHeight={18}
        color="$primary"
      >
        {`+${p.count} more · see Workout details`}
      </Text>
    </Pressable>
  );
}

function Totals(p: SessionSummaryPresenterProps & { unit: WeightUnit }) {
  const m = p.model;
  const units = p.unit === "lb" ? "imperial" : "metric";
  const cardio = m.volumeKg === 0 && m.distanceMeters > 0;
  const big = cardio
    ? {
        value: activityDistanceFromMeters(m.distanceMeters, units).toFixed(1),
        unit: activityDistanceUnit(units),
      }
    : { value: volumeText(m.volumeKg, p.unit), unit: p.unit };
  const effort = p.rating != null ? getDifficultyColor(p.rating) : null;
  return (
    <>
      <Brand />
      <Text
        marginTop={26}
        fontFamily="$display"
        fontWeight="700"
        fontSize={26}
        lineHeight={32}
        letterSpacing={-0.5}
        color="$text"
        textAlign="center"
      >
        Workout complete
      </Text>
      <Track marginTop={10}>{`${m.name} · ${shortDate(m.startedAt)}`}</Track>
      <Big marginTop={30} value={big.value} unit={big.unit} />
      <Trio
        marginTop={30}
        items={[
          { value: String(m.sets), label: "Sets" },
          { value: String(m.reps), label: "Reps" },
          { value: minutes(m.durationSeconds), label: "Duration" },
        ]}
      />
      {p.rating != null && effort && (
        <View
          marginTop={30}
          paddingVertical={8}
          paddingHorizontal={14}
          borderRadius={999}
          borderWidth={1}
          style={{
            borderColor: tint(effort, 0.45),
            backgroundColor: tint(effort, 0.08),
          }}
          testID="summary-effort"
        >
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={13}
            lineHeight={18}
            style={{ color: effort }}
          >
            {`Effort ${p.rating}/10 · ${getDifficultyMessage(p.rating)}`}
          </Text>
        </View>
      )}
      {p.workoutsThisMonth != null && (
        <Text
          marginTop={18}
          fontFamily="$body"
          fontSize={13}
          lineHeight={18}
          color="$text3"
        >
          {`${p.workoutsThisMonth} ${p.workoutsThisMonth === 1 ? "workout" : "workouts"} this month`}
        </Text>
      )}
    </>
  );
}

function Muscles({ muscles }: { muscles: MuscleShare }) {
  return (
    <>
      <Brand />
      <Track marginTop={22}>Muscles worked</Track>
      <View marginTop={22}>
        <MuscleMap muscles={muscles} />
      </View>
      <Trio
        marginTop={24}
        items={muscles.top.map((m) => ({
          value: `${m.share}%`,
          label: m.sets
            ? `${m.label} · ${m.sets} ${m.sets === 1 ? "set" : "sets"}`
            : m.label,
        }))}
      />
    </>
  );
}

function Exercises(p: { model: WorkoutSummaryModel; onDetails(): void }) {
  const rows = p.model.exercises.slice(0, MAX_EXERCISES);
  const rest = p.model.exercises.length - rows.length;
  return (
    <View alignSelf="stretch">
      <Brand left />
      <Text
        marginTop={22}
        fontFamily="$display"
        fontWeight="800"
        fontSize={40}
        lineHeight={46}
        letterSpacing={-1.2}
        color="$text"
        numberOfLines={2}
      >
        {p.model.name}
      </Text>
      <Track left marginTop={8}>
        {`${shortDate(p.model.startedAt)} · ${minutes(p.model.durationSeconds)}`}
      </Track>
      <View
        height={1}
        backgroundColor="$border3"
        marginTop={22}
        marginBottom={8}
      />
      {rows.map((e, i) => (
        <View
          key={e.id}
          flexDirection="row"
          alignItems="baseline"
          paddingVertical={8}
        >
          <Text
            width={34}
            fontFamily="$mono"
            fontWeight="600"
            fontSize={13}
            lineHeight={18}
            color="$text3"
          >
            {String(i + 1).padStart(2, "0")}
          </Text>
          <Text
            flex={1}
            fontFamily="$display"
            fontWeight="600"
            fontSize={17}
            lineHeight={22}
            color="$text"
            numberOfLines={1}
          >
            {e.name}
          </Text>
          <Text
            marginLeft={8}
            fontFamily="$mono"
            fontWeight="500"
            fontSize={15}
            lineHeight={20}
            color="$text"
          >
            {e.setsLabel}
          </Text>
        </View>
      ))}
      {rest > 0 && <More count={rest} onPress={p.onDetails} />}
    </View>
  );
}

function Volume(p: {
  model: WorkoutSummaryModel;
  unit: WeightUnit;
  onDetails(): void;
}) {
  const rows = p.model.volume.slice(0, MAX_VOLUME);
  const max = rows[0]?.volumeKg ?? 1;
  const rest = p.model.volume.length - rows.length;
  return (
    <View alignSelf="stretch">
      <Brand left />
      <Track left marginTop={24}>
        Volume by exercise
      </Track>
      {rows.map((v) => (
        <View key={v.id}>
          <View
            flexDirection="row"
            justifyContent="space-between"
            alignItems="baseline"
            marginTop={18}
          >
            <Text
              flex={1}
              fontFamily="$display"
              fontWeight="600"
              fontSize={16}
              lineHeight={22}
              color="$text"
              numberOfLines={1}
            >
              {v.name}
            </Text>
            <Text
              marginLeft={8}
              fontFamily="$mono"
              fontWeight="700"
              fontSize={15}
              lineHeight={20}
              color="$text"
            >
              {`${volumeText(v.volumeKg, p.unit)} ${p.unit}`}
            </Text>
          </View>
          <View
            height={8}
            borderRadius={999}
            backgroundColor="$surface3"
            marginTop={8}
            overflow="hidden"
          >
            <View
              height={8}
              borderRadius={999}
              backgroundColor="$text"
              width={`${Math.round((v.volumeKg / max) * 100)}%`}
            />
          </View>
        </View>
      ))}
      {rest > 0 && <More count={rest} onPress={p.onDetails} />}
    </View>
  );
}

function Records(p: {
  records: readonly SummaryRecord[];
  unit: WeightUnit;
  onDetails(): void;
}) {
  const was = (r: SummaryRecord) =>
    r.previousValue != null
      ? ` · was ${recordText(r, r.previousValue, p.unit)}`
      : "";
  if (p.records.length === 1) {
    const r = p.records[0]!;
    const v = recordValue(r.recordType, r.newValue, p.unit);
    return (
      <>
        <Brand />
        <Track gold marginTop={40}>
          New personal record
        </Track>
        <Text
          marginTop={14}
          fontFamily="$display"
          fontWeight="700"
          fontSize={24}
          lineHeight={30}
          color="$text"
          textAlign="center"
        >
          {r.exerciseName}
        </Text>
        <Big gold marginTop={12} value={v.value} unit={v.unit} />
        <Text
          marginTop={10}
          fontFamily="$body"
          fontSize={14}
          lineHeight={20}
          color="$text3"
          textAlign="center"
        >
          {`${RECORD_LABEL[r.recordType]}${was(r)}`}
        </Text>
      </>
    );
  }
  const rows = p.records.slice(0, MAX_RECORDS);
  const rest = p.records.length - rows.length;
  return (
    <View alignSelf="stretch">
      <Brand left />
      <Track left gold marginTop={28}>
        {`${p.records.length} new personal records`}
      </Track>
      <View marginTop={18}>
        {rows.map((r) => (
          <View
            key={`${r.exerciseId}:${r.recordType}`}
            flexDirection="row"
            alignItems="center"
            gap={12}
            paddingVertical={14}
            borderBottomWidth={1}
            borderColor="$border2"
          >
            <IconMedal size={22} color={color.$gold} />
            <View flex={1} gap={2}>
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={17}
                lineHeight={22}
                color="$text"
                numberOfLines={1}
              >
                {r.exerciseName}
              </Text>
              <Text
                fontFamily="$body"
                fontSize={13}
                lineHeight={18}
                color="$text3"
              >
                {`${RECORD_LABEL[r.recordType]}${was(r)}`}
              </Text>
            </View>
            <Text
              fontFamily="$mono"
              fontWeight="700"
              fontSize={24}
              lineHeight={28}
              color="$gold"
            >
              {recordText(r, r.newValue, p.unit)}
            </Text>
          </View>
        ))}
      </View>
      {rest > 0 && <More count={rest} onPress={p.onDetails} />}
    </View>
  );
}

function Together(p: {
  model: WorkoutSummaryModel;
  together: SummaryTogether;
}) {
  const faces = [
    { name: p.together.self, tone: color.$primary },
    ...p.together.names.map((name, i) => ({
      name,
      tone: togetherToneColor(
        TOGETHER_PARTNER_TONES[i % TOGETHER_PARTNER_TONES.length]!,
      ),
    })),
  ];
  return (
    <>
      <Brand />
      <Track marginTop={40}>Trained together</Track>
      <View flexDirection="row" justifyContent="center" marginTop={26}>
        {faces.map((f, i) => (
          <View
            key={`${f.name}:${i}`}
            marginLeft={i ? -12 : 0}
            padding={4}
            borderRadius={999}
            backgroundColor="$bg"
          >
            <View
              width={68}
              height={68}
              borderRadius={999}
              borderWidth={2.5}
              backgroundColor="$bg"
              alignItems="center"
              justifyContent="center"
              style={{ borderColor: f.tone }}
            >
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={22}
                style={{ color: f.tone }}
              >
                {f.name.trim().charAt(0).toUpperCase()}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <Text
        marginTop={22}
        fontFamily="$display"
        fontWeight="700"
        fontSize={24}
        lineHeight={30}
        color="$text"
        textAlign="center"
      >
        {`With ${listNames(p.together.names)}`}
      </Text>
      <Track marginTop={12}>
        {`${p.model.name} · ${p.together.connection} · ${minutes(p.model.durationSeconds)}`}
      </Track>
      <Text
        marginTop={18}
        maxWidth={280}
        fontFamily="$body"
        fontSize={13}
        lineHeight={19}
        color="$text3"
        textAlign="center"
      >
        Everyone saved their own workout. Only names are shared here.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  dotHit: {
    height: 44,
    paddingHorizontal: 3,
    justifyContent: "center",
  },
});

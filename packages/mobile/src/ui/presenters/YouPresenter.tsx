import type { ReactNode, RefObject } from "react";
import { Pressable, RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polyline } from "react-native-svg";
import { Text, View } from "@tamagui/core";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import { ScreenGlow } from "@/ui/components/foundation/ScreenGlow";
import {
  IconBolt,
  IconCalendar,
  IconCrown,
  IconDumbbell,
  IconFlame,
  IconMedal,
  IconSettings,
  IconSparkles,
} from "@/ui/components/icons";
import { MuscleMap } from "@/ui/components/summary/MuscleMap";
import type { BodyMapShading } from "@/domain/services/youPage";
import type { ApiError } from "@/shared/errors";
import { color } from "@/ui/theme/tokens";
import {
  Eyebrow,
  IconButton,
  LiftRow,
  NavRow,
  SectionHead,
  SHADE_SWATCHES,
  Strip,
  TopBar,
  type LiftRowData,
} from "./you/youKit";

/**
 * <YouPresenter> — the athlete You page, canvas Y1 → Y1b → Y1c as one
 * scroll (PER-141, signed off 18 Nov; note `yn1`):
 *
 *   header · coaches · gallery · badges · muscles last 7 days ·
 *   last 7 days strip · weight / body fat / steps tiles · History ·
 *   top lifts last 7 days · See a recap
 *
 * Pure. Cache-first: renders whatever the container hands in and blocks on
 * a loader or error only when nothing at all is cached.
 *
 * Seams owned by other tickets:
 * - `coaches` — APP-A3 (PER-126) supplies several coaches; today the
 *   container maps the active relationships it already has.
 * - `gallery` — APP-F1 (PER-137). Null until then, and the row is hidden.
 */

export type YouCoach = {
  id: string;
  initials: string;
  name: string;
  subtitle: string;
};

export type YouPendingCoachRequest = {
  relationshipId: string;
  trainerName: string;
};

export type YouBadge = {
  label: string;
  earned: boolean;
  icon: "flame" | "bolt" | "dumbbell" | "medal" | "crown";
};

export type YouGallery = {
  /** "25 Oct" */
  dateLabel: string;
  photos: { pose: "Front" | "Side" | "Back"; uri: string }[];
};

export type YouMuscles = {
  shading: BodyMapShading;
  gender: "male" | "female";
  trainNext: { text: string; hint: string } | null;
  rest: { text: string; hint: string } | null;
};

export type YouTile = {
  value: string | null;
  unit: string;
  detail: string | null;
  /** Readings oldest first, for the line. */
  series: readonly number[];
};

export type YouSteps = {
  today: string | null;
  detail: string | null;
  /** Seven days, oldest first; null for a day with no reading. */
  days: readonly (number | null)[];
  accessibilityLabel: string;
};

export type YouPresenterProps = {
  initials: string;
  coaches: readonly YouCoach[];
  /** Coach requests the athlete can review (kept until APP-A3 re-homes them). */
  pendingRequestCount: number;
  myPendingCoachRequests: readonly YouPendingCoachRequest[];
  gallery: YouGallery | null;
  badges: readonly YouBadge[];
  muscles: YouMuscles;
  lastSevenDays: { workouts: string; volume: string; time: string };
  weight: YouTile;
  bodyFat: YouTile;
  steps: YouSteps;
  topLifts: readonly LiftRowData[];

  hasData: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;

  onRefresh(): void;
  onOpenDrawer(): void;
  onOpenSettings(): void;
  onOpenCoach?: (id: string) => void;
  onOpenRequests(): void;
  onOpenAcceptInvite(): void;
  onOpenBadges(): void;
  onOpenWeight(): void;
  onOpenBodyFat(): void;
  onOpenHistory(): void;
  onOpenRecap(): void;
  scrollRef?: RefObject<ScrollView | null>;
};

export function YouPresenter(p: YouPresenterProps) {
  const insets = useSafeAreaInsets();

  if (p.isLoading && !p.hasData) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        testID="you-loader"
      >
        <PLogoDrawLoader />
      </View>
    );
  }
  if (p.error && !p.hasData) {
    return (
      <View flex={1} testID="you-error-state">
        <ErrorState
          message="Couldn't load your progress."
          onRetry={p.onRefresh}
        />
      </View>
    );
  }

  const earned = p.badges.filter((b) => b.earned).length;

  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="you-screen"
    >
      <ScreenGlow />
      <TopBar
        left={
          <IconButton
            label="Profile"
            onPress={p.onOpenDrawer}
            tint="primary"
            testID="you-profile"
          >
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={14}
              color="$primary"
            >
              {p.initials}
            </Text>
          </IconButton>
        }
        title="You"
        right={
          <IconButton
            label="Settings"
            onPress={p.onOpenSettings}
            testID="you-settings"
          >
            <IconSettings size={20} color={color.$text} />
          </IconButton>
        }
      />
      <ScrollView
        ref={p.scrollRef}
        testID="you-scroll"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={p.isRefreshing} onRefresh={p.onRefresh} />
        }
      >
        <Coaching {...p} />

        {p.gallery && <GalleryRow gallery={p.gallery} />}

        <SectionHead
          title="Badges"
          link={{
            label: `${earned} of ${p.badges.length} · See all`,
            onPress: p.onOpenBadges,
            testID: "you-badges-all",
          }}
        />
        <View flexDirection="row" gap={6} marginTop={8} testID="you-badges">
          {p.badges.map((b) => (
            <Badge key={b.label} badge={b} />
          ))}
        </View>

        <SectionHead title="Muscles · last 7 days" />
        <Muscles muscles={p.muscles} />

        <SectionHead title="Last 7 days" />
        <Strip
          testID="you-last7"
          items={[
            { value: p.lastSevenDays.workouts, label: "Workouts" },
            { value: p.lastSevenDays.volume, label: "Volume" },
            { value: p.lastSevenDays.time, label: "Time" },
          ]}
        />

        <View flexDirection="row" gap={8} marginTop={12}>
          <LineTile
            label="Weight"
            tile={p.weight}
            onPress={p.onOpenWeight}
            testID="you-weight"
          />
          <LineTile
            label="Body fat"
            tile={p.bodyFat}
            onPress={p.onOpenBodyFat}
            testID="you-bodyfat"
          />
        </View>
        <StepsTile steps={p.steps} />

        <View marginTop={22}>
          <NavRow
            borderTop
            leading={<IconCalendar size={20} color={color.$primary} />}
            title="History"
            subtitle="Every day you logged: workouts, food, steps, weight, habits"
            onPress={p.onOpenHistory}
            testID="you-history"
          />
        </View>

        <SectionHead title="Top lifts · last 7 days" />
        <View marginTop={4} testID="you-top-lifts">
          {p.topLifts.length ? (
            p.topLifts.map((l) => (
              <LiftRow key={l.key} lift={l} testID={`you-lift-${l.rank}`} />
            ))
          ) : (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$text3"
              paddingVertical={10}
              testID="you-top-lifts-empty"
            >
              No lifts in the last 7 days.
            </Text>
          )}
        </View>

        <Pressable
          onPress={p.onOpenRecap}
          accessibilityRole="button"
          testID="you-recap"
          style={{ marginTop: 22 }}
        >
          <View
            height={52}
            borderRadius={14}
            backgroundColor="$primary"
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            gap={8}
          >
            <IconSparkles size={16} color={color.$primaryInk} />
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={15}
              lineHeight={18}
              color="$primaryInk"
            >
              See a recap
            </Text>
          </View>
        </Pressable>
        <Text
          fontFamily="$body"
          fontSize={12}
          color="$text3"
          marginTop={8}
          textAlign="center"
        >
          This week, this month or 3 months · shareable
        </Text>
      </ScrollView>
    </View>
  );
}

function Coaching(p: YouPresenterProps) {
  return (
    <View testID="you-coaches">
      <Eyebrow>COACHES</Eyebrow>
      <View marginTop={4}>
        {p.coaches.map((c) => (
          <NavRow
            key={c.id}
            leading={
              <View
                width={40}
                height={40}
                borderRadius={999}
                backgroundColor="$accentTrainerDim"
                alignItems="center"
                justifyContent="center"
              >
                <Text
                  fontFamily="$display"
                  fontWeight="700"
                  fontSize={13}
                  color="$accentTrainer"
                >
                  {c.initials}
                </Text>
              </View>
            }
            title={c.name}
            subtitle={c.subtitle}
            onPress={p.onOpenCoach ? () => p.onOpenCoach!(c.id) : undefined}
            testID={`you-coach-${c.id}`}
          />
        ))}
        {p.myPendingCoachRequests.map((r) => (
          <NavRow
            key={r.relationshipId}
            title={`Request sent to ${r.trainerName} — awaiting acceptance`}
            testID={`you-pending-coach-request-${r.relationshipId}`}
          />
        ))}
        {p.pendingRequestCount > 0 && (
          <NavRow
            title={
              p.pendingRequestCount === 1
                ? "1 pending request"
                : `${p.pendingRequestCount} pending requests`
            }
            subtitle="A coach wants to connect with you."
            trailing={
              <Chip
                label="Review"
                onPress={p.onOpenRequests}
                testID="you-trainer-review"
              />
            }
            testID="you-trainer-pending"
          />
        )}
        <NavRow
          title="Have a coach's code?"
          subtitle="Enter it or scan their QR"
          trailing={
            <Chip
              label="Enter code"
              onPress={p.onOpenAcceptInvite}
              testID="you-accept-invite-button"
            />
          }
          testID="you-accept-invite-entry"
        />
      </View>
    </View>
  );
}

/** Canvas `.chip` in the coach colour, 36pt tall. */
function Chip(p: { label: string; onPress(): void; testID?: string }) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      hitSlop={4}
      testID={p.testID}
    >
      <View
        height={36}
        paddingHorizontal={12}
        borderRadius={999}
        borderWidth={1}
        borderColor="rgba(167,139,250,0.45)"
        backgroundColor="$surface"
        alignItems="center"
        justifyContent="center"
      >
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={12}
          color="$accentTrainer"
        >
          {p.label}
        </Text>
      </View>
    </Pressable>
  );
}

function GalleryRow({ gallery }: { gallery: YouGallery }) {
  return (
    <View testID="you-gallery">
      <SectionHead title={`Gallery · ${gallery.dateLabel}`} />
    </View>
  );
}

const BADGE_ICON: Record<YouBadge["icon"], typeof IconFlame> = {
  flame: IconFlame,
  bolt: IconBolt,
  dumbbell: IconDumbbell,
  medal: IconMedal,
  crown: IconCrown,
};

function Badge({ badge }: { badge: YouBadge }) {
  const Icon = BADGE_ICON[badge.icon];
  const tint = badge.earned ? color.$ember : color.$surface5;
  return (
    <View
      flex={1}
      height={72}
      borderRadius={14}
      alignItems="center"
      justifyContent="center"
      gap={6}
      backgroundColor={badge.earned ? "rgba(251,146,60,0.12)" : "$surface"}
      borderWidth={1}
      borderColor={badge.earned ? "rgba(251,146,60,0.35)" : "$border"}
      accessible
      accessibilityLabel={`${badge.label} streak badge, ${badge.earned ? "earned" : "not yet"}`}
      testID={`you-badge-${badge.label}${badge.earned ? "-earned" : ""}`}
    >
      <Icon size={20} color={tint} />
      <Text
        fontFamily="$display"
        fontWeight="600"
        fontSize={12}
        letterSpacing={0.5}
        color={tint}
      >
        {badge.label}
      </Text>
      {badge.earned && (
        <View
          position="absolute"
          top={6}
          right={6}
          width={7}
          height={7}
          borderRadius={999}
          backgroundColor="$ember"
        />
      )}
    </View>
  );
}

function Muscles({ muscles }: { muscles: YouMuscles }) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={12}
      marginTop={6}
      testID="you-muscles"
    >
      <MuscleMap
        muscles={muscles.shading}
        height={160}
        gap={2}
        gender={muscles.gender}
        testID="you-muscle-map"
      />
      <View flex={1} gap={10}>
        {muscles.trainNext && (
          <MuscleGroup
            label="Train next"
            labelColor="$text2"
            group={muscles.trainNext}
            testID="you-train-next"
          />
        )}
        {muscles.rest && (
          <MuscleGroup
            label="Rest"
            labelColor="$primary"
            group={muscles.rest}
            testID="you-rest"
          />
        )}
        <View
          flexDirection="row"
          alignItems="center"
          gap={5}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text
            fontFamily="$display"
            fontWeight="500"
            fontSize={10.5}
            color="$text3"
          >
            Train
          </Text>
          {SHADE_SWATCHES.map((c) => (
            <View
              key={c}
              width={12}
              height={8}
              borderRadius={3}
              backgroundColor={c}
            />
          ))}
          <Text
            fontFamily="$display"
            fontWeight="500"
            fontSize={10.5}
            color="$text3"
          >
            Rest
          </Text>
        </View>
      </View>
    </View>
  );
}

function MuscleGroup(p: {
  label: string;
  labelColor: string;
  group: { text: string; hint: string };
  testID: string;
}) {
  return (
    <View testID={p.testID}>
      <Text
        fontFamily="$display"
        fontWeight="600"
        fontSize={10}
        lineHeight={14}
        letterSpacing={2.6}
        textTransform="uppercase"
        color={p.labelColor}
      >
        {p.label}
      </Text>
      <Text
        fontFamily="$display"
        fontWeight="600"
        fontSize={14}
        lineHeight={19}
        color="$text"
      >
        {p.group.text}
      </Text>
      <Text fontFamily="$body" fontSize={11.5} lineHeight={15} color="$text3">
        {p.group.hint}
      </Text>
    </View>
  );
}

function TileShell(p: {
  children: ReactNode;
  onPress?: () => void;
  minHeight: number;
  testID: string;
  label: string;
}) {
  const body = (
    <View
      borderRadius={16}
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$border"
      paddingVertical={12}
      paddingHorizontal={14}
      gap={2}
      minHeight={p.minHeight}
    >
      {p.children}
    </View>
  );
  return p.onPress ? (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={p.label}
      style={{ flex: 1 }}
      testID={p.testID}
    >
      {body}
    </Pressable>
  ) : (
    <View flex={1} testID={p.testID}>
      {body}
    </View>
  );
}

function TileValue(p: { value: string | null; unit: string }) {
  return (
    <Text
      fontFamily="$mono"
      fontWeight="700"
      fontSize={24}
      lineHeight={30}
      color="$text"
    >
      {p.value ?? "—"}
      {p.value != null && (
        <Text
          fontFamily="$display"
          fontWeight="500"
          fontSize={12}
          color="$text3"
        >
          {` ${p.unit}`}
        </Text>
      )}
    </Text>
  );
}

function LineTile(p: {
  label: string;
  tile: YouTile;
  onPress(): void;
  testID: string;
}) {
  const t = p.tile;
  return (
    <TileShell
      onPress={p.onPress}
      minHeight={118}
      testID={p.testID}
      label={`${p.label}${t.value ? `, ${t.value} ${t.unit}` : ""}${t.detail ? `, ${t.detail}` : ""}`}
    >
      <Text fontFamily="$display" fontWeight="500" fontSize={13} color="$text2">
        {p.label}
      </Text>
      <TileValue value={t.value} unit={t.unit} />
      {!!t.detail && (
        <Text fontFamily="$body" fontSize={11.5} color="$text3">
          {t.detail}
        </Text>
      )}
      <Sparkline series={t.series} />
    </TileShell>
  );
}

/** The tile line: readings spread across 150 × 34, newest on the right. */
export function sparklinePoints(series: readonly number[]): string | null {
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  return series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * 150;
      const y = 30 - ((v - min) / span) * 26;
      return `${Math.round(x)},${Math.round(y)}`;
    })
    .join(" ");
}

function Sparkline({ series }: { series: readonly number[] }) {
  const points = sparklinePoints(series);
  if (!points) return <View height={34} />;
  return (
    <View
      height={34}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="you-sparkline"
    >
      <Svg
        width="100%"
        height={34}
        viewBox="0 0 150 34"
        preserveAspectRatio="none"
      >
        <Polyline
          points={points}
          fill="none"
          stroke={color.$primary}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
}

function StepsTile({ steps }: { steps: YouSteps }) {
  const max = Math.max(1, ...steps.days.map((d) => d ?? 0));
  return (
    <View marginTop={8}>
      <TileShell minHeight={104} testID="you-steps" label="Steps">
        <View
          flexDirection="row"
          justifyContent="space-between"
          alignItems="baseline"
        >
          <Text
            fontFamily="$display"
            fontWeight="500"
            fontSize={13}
            color="$text2"
          >
            Steps
          </Text>
          {!!steps.detail && (
            <Text fontFamily="$body" fontSize={11.5} color="$text3">
              {steps.detail}
            </Text>
          )}
        </View>
        <TileValue value={steps.today} unit="today" />
        <View
          flexDirection="row"
          gap={6}
          alignItems="flex-end"
          height={34}
          accessible
          accessibilityRole="image"
          accessibilityLabel={steps.accessibilityLabel}
          testID="you-steps-bars"
        >
          {steps.days.map((d, i) => (
            <View
              key={i}
              flex={1}
              height={d ? Math.max(2, Math.round((d / max) * 34)) : 2}
              borderTopLeftRadius={4}
              borderTopRightRadius={4}
              borderBottomLeftRadius={2}
              borderBottomRightRadius={2}
              backgroundColor={
                i === steps.days.length - 1
                  ? "$primary"
                  : "rgba(34,211,238,0.45)"
              }
            />
          ))}
        </View>
      </TileShell>
    </View>
  );
}

import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import {
  Avatar,
  Bar,
  Btn,
  Card,
  IconBtn,
  Pill,
} from "@/ui/components/foundation";
import { toneHex, type Tone } from "@/ui/components/foundation/tones";
import { ProgrammeCard, Section } from "@/ui/components/composite";
import {
  IconBack,
  IconEdit,
  IconInfo,
  IconMessage,
  IconMore_v,
  IconNote,
  IconPlus,
  IconSparkles,
  IconTarget,
} from "@/ui/components/icons";
import {
  BodyTrendPresenter,
  type TrendData,
} from "@/ui/presenters/BodyTrendPresenter";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import type { ApiError } from "@/shared/errors";
import type {
  AdherenceModule,
  AiSummaryModule,
  CalorieHitModule,
  ClientDetail,
  GoalModule,
  VolumeModule,
} from "@/domain/models/clientDetail";
import type { ActiveProgramme } from "@/domain/models/progress";
import type { CoachClientAssignment } from "@/domain/ports/api.port";
import { relativeTime } from "@/ui/presenters/coach/RecentActivityFeedPresenter";

/**
 * <ClientDetailPresenter> — the full single-scroll Client Detail screen
 * (M8 Coach Phase 5). Ports `~/Downloads/handoff/design-source/screens/
 * client-detail.jsx` section order 1:1:
 *
 *   ClientHeader → LiveSessionCTA → QuickActionsRow → AISummaryCard →
 *   GoalCard → [Body-trend + Log-weight, kept from #146] → TargetsCard →
 *   ThisWeekCard → AdherenceBreakdown → ProgrammeCard → CoachNotesCard.
 *
 * Pure presentational; cache-first (renders whatever aggregate data is present,
 * blocking loader/error only when there's nothing at all — the CoachYou
 * pattern). Trainer-purple accent throughout. All actions are lifted to the
 * container; LiveSessionCTA is display-only (no on-behalf session logging this
 * phase — open decision ①).
 */

const BAND_TONE: Record<NonNullable<AdherenceModule["band"]>, Tone> = {
  stellar: "gold",
  strong: "success",
  wobbling: "gold",
  atRisk: "ember",
  crisis: "error",
};

const BAND_LABEL: Record<NonNullable<AdherenceModule["band"]>, string> = {
  stellar: "Stellar",
  strong: "Strong",
  wobbling: "Wobbling",
  atRisk: "At risk",
  crisis: "Crisis",
};

export type ClientDetailProps = {
  /** The aggregate payload, or null before the first fetch resolves. */
  detail: ClientDetail | null;
  /** Fallback header name (from route params) before the aggregate lands. */
  clientName: string | null;
  bodyTrend: { weight: TrendData & { unit: "kg" | "lb" }; bodyFat: TrendData };
  /** The client's live programme, or null (specs/19-programs AC 4.5). */
  activeProgramme: ActiveProgramme | null;
  /** The client's OPEN assignments — the M18 Upcoming-sessions surface. */
  assignments: CoachClientAssignment[];
  /** True until the first aggregate/trend fetch resolves. */
  isLoading: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  onRefresh: () => void;
  onBack: () => void;
  onLogWeight: () => void;
  onManageHabits: () => void;
  /** QuickActionsRow — Assign → AssignWorkoutSheet. */
  onAssignWorkout: () => void;
  /** QuickActionsRow — Macros → EditNutritionTargetsSheet. */
  onEditTargets: () => void;
  /** QuickActionsRow — Goals → AssignGoalSheet (create). */
  onAssignGoal: () => void;
  /** QuickActionsRow — Brief → SendBriefSheet (M17 Send brief). */
  onSendBrief: () => void;
  /** Upcoming-sessions row Swap → SwapWorkoutSheet (M18). */
  onSwapWorkout: (assignment: CoachClientAssignment) => void;
  /** GoalCard pencil → AssignGoalSheet (edit) — only offered when assignedByCoach. */
  onEditGoal: () => void;
  /** Tap the ProgrammeCard → open the programme editor. */
  onOpenProgramme: () => void;
  /** Open the assign-programme sheet (client-anchored). */
  onAssignProgramme: () => void;
  /** Notes card "+" → open the note composer (create). */
  onAddNote: () => void;
  /** Tap a note → open the note composer (edit/delete). */
  onEditNote: (note: ClientDetail["notes"][number]) => void;
  /** True while an AI-summary generate/refresh is in flight (Phase 6). */
  isGeneratingSummary: boolean;
  /** Whether the device is online — AI generation is online-only. */
  online: boolean;
  /** Regenerate tap → POST ai-summary { manual: true }, then refresh. */
  onRegenerateSummary: () => void;
};

export function ClientDetailPresenter(props: ClientDetailProps) {
  const {
    detail,
    clientName,
    bodyTrend,
    activeProgramme,
    assignments,
    isLoading,
    isRefreshing,
    error,
    onRefresh,
    onBack,
    onLogWeight,
    onManageHabits,
    onAssignWorkout,
    onEditTargets,
    onAssignGoal,
    onSendBrief,
    onSwapWorkout,
    onEditGoal,
    onOpenProgramme,
    onAssignProgramme,
    onAddNote,
    onEditNote,
    isGeneratingSummary,
    online,
    onRegenerateSummary,
  } = props;

  const insets = useSafeAreaInsets();

  if (isLoading && detail === null) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        testID="client-detail-loader"
      >
        <PLogoDrawLoader />
      </View>
    );
  }
  if (error && detail === null) {
    return (
      <View flex={1} testID="client-detail-error-state">
        <ErrorState message="Couldn't load this client." onRetry={onRefresh} />
      </View>
    );
  }

  return (
    <View flex={1} paddingTop={insets.top} testID="client-detail">
      <ScrollView
        testID="client-detail-scroll"
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <ClientHeader
          detail={detail}
          fallbackName={clientName}
          activeProgramme={activeProgramme}
          onBack={onBack}
        />

        <View paddingHorizontal={16} gap={16} marginTop={4}>
          <LiveSessionCTA activeProgramme={activeProgramme} />

          <QuickActionsRow
            onAssignWorkout={onAssignWorkout}
            onEditTargets={onEditTargets}
            onAssignGoal={onAssignGoal}
            onSendBrief={onSendBrief}
          />

          <AISummaryCard
            aiSummary={detail?.aiSummary ?? null}
            isGenerating={isGeneratingSummary}
            online={online}
            onRegenerate={onRegenerateSummary}
          />

          {detail?.goal ? (
            <GoalCard goal={detail.goal} onEdit={onEditGoal} />
          ) : null}

          {/* Body-trend + Log-weight kept from #146 (open decision ②),
              slotted after the goal per the brief. */}
          <BodyTrendSection
            bodyTrend={bodyTrend}
            isLoading={isLoading}
            error={error}
            onLogWeight={onLogWeight}
          />

          <TargetsCard
            calorieHit={detail?.calorieHit ?? null}
            onEdit={onEditTargets}
          />

          <ThisWeekCard detail={detail} />

          <AdherenceBreakdown adherence={detail?.adherence ?? null} />

          <ProgrammeSection
            activeProgramme={activeProgramme}
            onOpenProgramme={onOpenProgramme}
            onAssignProgramme={onAssignProgramme}
            onAssignWorkout={onAssignWorkout}
            onManageHabits={onManageHabits}
          />

          <UpcomingSessionsCard
            assignments={assignments}
            onSwap={onSwapWorkout}
          />

          <CoachNotesCard
            notes={detail?.notes ?? []}
            onAddNote={onAddNote}
            onEditNote={onEditNote}
          />
        </View>
      </ScrollView>
    </View>
  );
}

// ── ClientHeader ────────────────────────────────────────────────────────────
function ClientHeader({
  detail,
  fallbackName,
  activeProgramme,
  onBack,
}: {
  detail: ClientDetail | null;
  fallbackName: string | null;
  activeProgramme: ActiveProgramme | null;
  onBack: () => void;
}) {
  const name = detail?.client.name ?? fallbackName ?? "Client";
  const initials =
    detail?.client.initials ?? (fallbackName ? initialsOf(fallbackName) : "?");
  const age = detail?.client.ageYears ?? null;
  const heightCm = detail?.client.heightCm ?? null;
  const programmeLabel = activeProgramme?.name ?? null;

  // Age · height · programme — hide null segments (design.md § client header).
  const metaParts: string[] = [];
  if (age != null) metaParts.push(`Age ${age}`);
  if (heightCm != null) metaParts.push(`${heightCm} cm`);
  if (programmeLabel) metaParts.push(programmeLabel);
  const meta = metaParts.join(" · ");

  const missed = missedCount(detail);
  const week = activeProgramme?.week ?? null;
  const totalWeeks = activeProgramme?.totalWeeks ?? null;

  return (
    <View>
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal={16}
        paddingTop={8}
        paddingBottom={12}
      >
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to clients"
          testID="client-detail-back"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <View flexDirection="row" alignItems="center" gap={4} padding={6}>
            <IconBack size={18} color="#C2C2CE" />
            <Text fontFamily="$body" fontSize={13.5} color="$text2">
              Clients
            </Text>
          </View>
        </Pressable>
        <View flexDirection="row" gap={6}>
          <IconBtn
            icon={<IconMessage size={17} />}
            tone="ghost"
            accessibilityLabel="Message client"
            testID="client-detail-message"
          />
          <IconBtn
            icon={<IconMore_v size={17} />}
            tone="ghost"
            accessibilityLabel="More"
            testID="client-detail-more"
          />
        </View>
      </View>

      <View
        flexDirection="row"
        gap={14}
        alignItems="center"
        paddingHorizontal={20}
        paddingBottom={14}
      >
        <Avatar initials={initials} size={64} tone="trainer" />
        <View flex={1}>
          <Text
            fontFamily="$display"
            fontWeight="800"
            fontSize={22}
            letterSpacing={-0.5}
            color="$text"
            numberOfLines={1}
            testID="client-detail-name"
          >
            {name}
          </Text>
          {meta ? (
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$text3"
              marginTop={2}
              testID="client-detail-meta"
            >
              {meta}
            </Text>
          ) : null}
          <View flexDirection="row" gap={6} marginTop={8}>
            {missed != null && missed > 0 ? (
              <Pill tone="ember" size="xs" testID="client-detail-missed-pill">
                {`${missed} missed`}
              </Pill>
            ) : null}
            {week != null && totalWeeks != null ? (
              <Pill tone="trainer" size="xs" testID="client-detail-week-pill">
                {`WK ${week}/${totalWeeks}`}
              </Pill>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

// ── LiveSessionCTA (display-only) ────────────────────────────────────────────
function LiveSessionCTA({
  activeProgramme,
}: {
  activeProgramme: ActiveProgramme | null;
}) {
  const trainerGlow = toneHex("trainer").glow;

  if (!activeProgramme) {
    return (
      <Card
        pad={16}
        radius={18}
        accent="trainer"
        testID="client-detail-live-session"
      >
        <View flexDirection="row" alignItems="center" gap={6} marginBottom={4}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
          >
            Today&rsquo;s session
          </Text>
        </View>
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$text3"
          testID="client-detail-live-session-empty"
        >
          No active programme — assign one to schedule this client&rsquo;s
          training.
        </Text>
      </Card>
    );
  }

  const weekLabel =
    activeProgramme.totalWeeks != null
      ? `Week ${activeProgramme.week} of ${activeProgramme.totalWeeks}`
      : `Week ${activeProgramme.week}`;

  return (
    <Card
      pad={0}
      radius={18}
      accent="trainer"
      testID="client-detail-live-session"
      style={{ backgroundColor: trainerGlow }}
    >
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        gap={12}
        padding={16}
      >
        <View flex={1}>
          <View
            flexDirection="row"
            alignItems="center"
            gap={6}
            marginBottom={4}
          >
            <View
              width={6}
              height={6}
              borderRadius={9999}
              backgroundColor="$success"
            />
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.7}
              textTransform="uppercase"
              color="$success"
            >
              Current programme
            </Text>
          </View>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={18}
            color="$text"
            numberOfLines={1}
            testID="client-detail-live-session-workout"
          >
            {activeProgramme.name}
          </Text>
          <Text fontFamily="$body" fontSize={11.5} color="$text3" marginTop={2}>
            {weekLabel}
          </Text>
        </View>
      </View>
    </Card>
  );
}

// ── UpcomingSessionsCard (M18 Live-session) ──────────────────────────────────
function UpcomingSessionsCard({
  assignments,
  onSwap,
}: {
  assignments: CoachClientAssignment[];
  onSwap: (assignment: CoachClientAssignment) => void;
}) {
  if (assignments.length === 0) return null;

  return (
    <Card pad={16} radius={16} testID="client-detail-upcoming-sessions">
      <Text
        fontFamily="$display"
        fontSize={10.5}
        fontWeight="600"
        letterSpacing={1.7}
        textTransform="uppercase"
        color="$text3"
        marginBottom={12}
      >
        Upcoming sessions
      </Text>
      <View gap={10}>
        {assignments.map((a) => (
          <View
            key={a.assignmentId}
            flexDirection="row"
            alignItems="center"
            gap={12}
            testID={`upcoming-session-${a.assignmentId}`}
          >
            <View flex={1}>
              <View flexDirection="row" alignItems="center" gap={6}>
                <Text
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={14}
                  color="$text"
                  numberOfLines={1}
                >
                  {a.name ?? "Workout"}
                </Text>
                {a.isSwapped ? (
                  <Pill
                    tone="trainer"
                    testID={`upcoming-swapped-${a.assignmentId}`}
                  >
                    Swapped
                  </Pill>
                ) : null}
              </View>
              <Text
                fontFamily="$body"
                fontSize={11.5}
                color="$text3"
                marginTop={2}
              >
                {a.dueDate ? `Due ${a.dueDate}` : "No due date"}
                {a.isProgrammeOccurrence ? " · Programme" : ""}
              </Text>
            </View>
            <Btn
              variant="soft"
              tone="trainer"
              onPress={() => onSwap(a)}
              testID={`upcoming-swap-${a.assignmentId}`}
            >
              Swap
            </Btn>
          </View>
        ))}
      </View>
    </Card>
  );
}

// ── QuickActionsRow ──────────────────────────────────────────────────────────
function QuickActionsRow({
  onAssignWorkout,
  onEditTargets,
  onAssignGoal,
  onSendBrief,
}: {
  onAssignWorkout: () => void;
  onEditTargets: () => void;
  onAssignGoal: () => void;
  onSendBrief: () => void;
}) {
  // Prototype has Assign / Macros / Goals / Schedule; Schedule is HIDDEN
  // (scheduling domain parked, design.md ~765) — Brief (M17) takes the
  // fourth slot.
  const actions: {
    key: string;
    label: string;
    tone: Tone;
    onPress: () => void;
    testID: string;
  }[] = [
    {
      key: "assign",
      label: "Assign",
      tone: "primary",
      onPress: onAssignWorkout,
      testID: "quick-action-assign",
    },
    {
      key: "macros",
      label: "Macros",
      tone: "gold",
      onPress: onEditTargets,
      testID: "quick-action-macros",
    },
    {
      key: "goals",
      label: "Goals",
      tone: "trainer",
      onPress: onAssignGoal,
      testID: "quick-action-goals",
    },
    {
      key: "brief",
      label: "Brief",
      tone: "ember",
      onPress: onSendBrief,
      testID: "quick-action-brief",
    },
  ];

  return (
    <View flexDirection="row" gap={8} testID="client-detail-quick-actions">
      {actions.map((a) => (
        <Pressable
          key={a.key}
          onPress={a.onPress}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          testID={a.testID}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1 })}
        >
          <View
            alignItems="center"
            gap={6}
            paddingVertical={12}
            paddingHorizontal={6}
            backgroundColor="$surface2"
            borderColor="$border"
            borderWidth={1}
            borderRadius={12}
          >
            <IconTarget size={16} color={toneHex(a.tone).base} />
            <Text
              fontFamily="$display"
              fontSize={11}
              fontWeight="500"
              color="$text2"
            >
              {a.label}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// ── AISummaryCard (STORY-014, Phase 6) ───────────────────────────────────────
function AISummaryCard({
  aiSummary,
  isGenerating,
  online,
  onRegenerate,
}: {
  aiSummary: AiSummaryModule | null;
  isGenerating: boolean;
  online: boolean;
  onRegenerate: () => void;
}) {
  const summary = aiSummary?.summary ?? null;
  const generatedAt = aiSummary?.generatedAt ?? null;
  // The Regenerate affordance: only when the server says the one manual refresh
  // is still available (row exists, unused, ai_access, under ceiling) AND we're
  // online AND nothing is already in flight.
  const canRegenerate =
    (aiSummary?.canManualRefresh ?? false) && online && !isGenerating;

  return (
    <Card
      pad={16}
      radius={18}
      accent="trainer"
      testID="client-detail-ai-summary"
    >
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        marginBottom={12}
      >
        <View flexDirection="row" alignItems="center" gap={8}>
          <IconSparkles size={16} color={toneHex("trainer").base} />
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$accentTrainer"
          >
            AI weekly summary
          </Text>
        </View>
        {summary != null && generatedAt != null ? (
          <Text
            fontFamily="$body"
            fontSize={11}
            color="$text3"
            testID="client-detail-ai-summary-updated"
          >
            Updated {relativeTime(generatedAt, Date.now())} ago
          </Text>
        ) : null}
      </View>

      {isGenerating ? (
        <View
          flexDirection="row"
          alignItems="center"
          gap={8}
          testID="client-detail-ai-summary-generating"
        >
          <ActivityIndicator size="small" color={toneHex("trainer").base} />
          <Text fontFamily="$body" fontSize={14} lineHeight={20} color="$text3">
            Generating today’s summary…
          </Text>
        </View>
      ) : summary != null ? (
        <Text
          fontFamily="$body"
          fontSize={14}
          lineHeight={20}
          color="$text1"
          testID="client-detail-ai-summary-text"
        >
          {summary}
        </Text>
      ) : (
        <Text
          fontFamily="$body"
          fontSize={14}
          lineHeight={20}
          color="$text3"
          testID="client-detail-ai-summary-empty"
        >
          {online
            ? "No summary yet — one will be generated from this client’s recent training and nutrition."
            : "Connect to the internet to generate this client’s AI summary."}
        </Text>
      )}

      {summary != null ? (
        <View marginTop={12} alignSelf="flex-start">
          <Btn
            variant="soft"
            tone="trainer"
            size="sm"
            disabled={!canRegenerate}
            onPress={onRegenerate}
            testID="client-detail-ai-regenerate"
          >
            {aiSummary?.canManualRefresh
              ? "Regenerate"
              : "Next update tomorrow"}
          </Btn>
        </View>
      ) : null}
    </Card>
  );
}

// ── GoalCard ─────────────────────────────────────────────────────────────────
function GoalCard({ goal, onEdit }: { goal: GoalModule; onEdit: () => void }) {
  const { startKg, nowKg, targetKg } = goal.weight;
  const pct = goal.pct ?? 0;

  return (
    <Card pad={16} radius={16} testID="client-detail-goal">
      <View
        flexDirection="row"
        alignItems="flex-start"
        justifyContent="space-between"
        marginBottom={12}
      >
        <View flex={1}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
            marginBottom={4}
          >
            Primary goal
          </Text>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={18}
            color="$text"
            testID="client-detail-goal-title"
          >
            {goal.title}
          </Text>
          {goal.assignedByCoach ? (
            <Text
              fontFamily="$body"
              fontSize={11.5}
              color="$text3"
              marginTop={2}
              testID="client-detail-goal-attribution"
            >
              Goal set by you
            </Text>
          ) : null}
        </View>
        {goal.assignedByCoach ? (
          <IconBtn
            icon={<IconEdit size={14} />}
            tone="ghost"
            size={32}
            onPress={onEdit}
            accessibilityLabel="Edit goal"
            testID="client-detail-goal-edit"
          />
        ) : null}
      </View>

      {goal.pct != null ? (
        <Bar
          pct={pct}
          color={toneHex("gold").base}
          height={4}
          glow
          testID="client-detail-goal-bar"
        />
      ) : null}

      <View flexDirection="row" justifyContent="space-between" marginTop={8}>
        <GoalTick label="Start" value={weightText(startKg, goal.unit)} />
        <GoalTick label="Now" value={weightText(nowKg, goal.unit)} accent />
        <GoalTick
          label="Target"
          value={weightText(targetKg, goal.unit)}
          align="right"
        />
      </View>
    </Card>
  );
}

function GoalTick({
  label,
  value,
  accent = false,
  align = "left",
}: {
  label: string;
  value: string;
  accent?: boolean;
  align?: "left" | "right";
}) {
  return (
    <View style={{ alignItems: align === "right" ? "flex-end" : "flex-start" }}>
      <Text
        fontFamily="$display"
        fontSize={9}
        fontWeight="600"
        letterSpacing={0.9}
        textTransform="uppercase"
        color={accent ? "$gold" : "$text3"}
      >
        {label}
      </Text>
      <Text
        fontFamily="$mono"
        fontSize={accent ? 14 : 12}
        fontWeight={accent ? "700" : "500"}
        color={accent ? "$gold" : "$text2"}
        marginTop={2}
      >
        {value}
      </Text>
    </View>
  );
}

// ── Body-trend section (kept from #146) ──────────────────────────────────────
function BodyTrendSection({
  bodyTrend,
  isLoading,
  error,
  onLogWeight,
}: {
  bodyTrend: { weight: TrendData & { unit: "kg" | "lb" }; bodyFat: TrendData };
  isLoading: boolean;
  error: ApiError | null;
  onLogWeight: () => void;
}) {
  const hasData =
    bodyTrend.weight.series.length > 0 || bodyTrend.bodyFat.series.length > 0;

  return (
    <Section eyebrow="Body" title="Trend" testID="client-detail-body">
      <View gap={12}>
        <BodyTrendPresenter
          weight={bodyTrend.weight}
          bodyFat={bodyTrend.bodyFat}
          testID="client-detail-body-trend"
        />
        {!isLoading && !error && !hasData ? (
          <Text fontSize={13} color="$text3" testID="client-detail-body-empty">
            No measurements in the last 30 days — log a weight to start the
            trend.
          </Text>
        ) : null}
        <Btn
          variant="soft"
          tone="trainer"
          icon={<IconPlus size={16} color={toneHex("trainer").ink} />}
          onPress={onLogWeight}
          testID="client-detail-log-weight"
        >
          Log weight
        </Btn>
      </View>
    </Section>
  );
}

// ── TargetsCard ──────────────────────────────────────────────────────────────
function TargetsCard({
  calorieHit,
  onEdit,
}: {
  calorieHit: CalorieHitModule | null;
  onEdit: () => void;
}) {
  // Module d only carries the calorie target. Protein / workouts / volume
  // aren't in the aggregate → "—" (the prototype's four-tile grid, degraded).
  const tiles: { label: string; value: string; unit: string; tone: Tone }[] = [
    {
      label: "Calories",
      value:
        calorieHit?.targetKcal != null ? String(calorieHit.targetKcal) : "—",
      unit: "kcal / day",
      tone: "gold",
    },
    { label: "Protein", value: "—", unit: "g / day", tone: "primary" },
    { label: "Workouts", value: "—", unit: "per week", tone: "ember" },
    { label: "Volume", value: "—", unit: "t / week", tone: "trainer" },
  ];

  return (
    <Card pad={0} radius={16} testID="client-detail-targets">
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        padding={16}
        paddingBottom={8}
      >
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={18}
          color="$text"
        >
          Targets
        </Text>
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel="Edit targets"
          testID="client-detail-targets-edit"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Text
            fontFamily="$display"
            fontSize={12}
            fontWeight="500"
            color="$primary"
          >
            Edit all
          </Text>
        </Pressable>
      </View>
      <View flexDirection="row" flexWrap="wrap">
        {tiles.map((t, i) => (
          <Pressable
            key={t.label}
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${t.label}`}
            testID={`client-detail-target-${t.label.toLowerCase()}`}
            style={({ pressed }) => ({
              width: "50%",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              gap={4}
              paddingVertical={12}
              paddingHorizontal={16}
              borderTopWidth={1}
              borderColor="$border"
              borderRightWidth={i % 2 === 0 ? 1 : 0}
            >
              <Text
                fontFamily="$display"
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1.7}
                textTransform="uppercase"
                color="$text3"
              >
                {t.label}
              </Text>
              <View flexDirection="row" alignItems="baseline" gap={4}>
                <Text
                  fontFamily="$mono"
                  fontSize={22}
                  fontWeight="700"
                  color={toneHex(t.tone).base}
                >
                  {t.value}
                </Text>
                <Text fontFamily="$mono" fontSize={10.5} color="$text3">
                  {t.unit}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

// ── ThisWeekCard ─────────────────────────────────────────────────────────────
function ThisWeekCard({ detail }: { detail: ClientDetail | null }) {
  const tw = detail?.thisWeek ?? null;
  const workouts =
    tw != null
      ? tw.workoutsPlanned != null
        ? `${tw.workoutsCompleted}/${tw.workoutsPlanned}`
        : String(tw.workoutsCompleted)
      : "—";
  const volume =
    tw?.volumeKg != null ? `${(tw.volumeKg / 1000).toFixed(1)}t` : "—";
  const prs = tw != null ? String(tw.prs) : "—";
  const checkIns = tw?.checkIns != null ? `${tw.checkIns}/7` : "—";

  return (
    <View testID="client-detail-this-week">
      <View marginBottom={10} paddingHorizontal={2}>
        <Text
          fontFamily="$display"
          fontSize={10.5}
          fontWeight="600"
          letterSpacing={1.7}
          textTransform="uppercase"
          color="$text3"
        >
          This week
        </Text>
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={24}
          letterSpacing={-0.5}
          color="$text"
        >
          Activity
        </Text>
      </View>

      <Card pad={16} radius={16}>
        <View
          flexDirection="row"
          gap={12}
          paddingBottom={12}
          borderBottomWidth={1}
          borderColor="$border"
        >
          <MiniStat label="Workouts" value={workouts} tone="primary" />
          <MiniStat label="Volume" value={volume} />
          <MiniStat label="PRs" value={prs} tone="gold" />
          <MiniStat label="Check-ins" value={checkIns} tone="success" />
        </View>
        <DailyBars volume={detail?.volume ?? null} />
      </Card>
    </View>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <View flex={1}>
      <Text
        fontFamily="$display"
        fontSize={9.5}
        fontWeight="600"
        letterSpacing={0.95}
        textTransform="uppercase"
        color="$text3"
      >
        {label}
      </Text>
      <Text
        fontFamily="$mono"
        fontSize={18}
        fontWeight="600"
        color={tone ? toneHex(tone).base : "$text"}
        marginTop={2}
      >
        {value}
      </Text>
    </View>
  );
}

function DailyBars({ volume }: { volume: VolumeModule | null }) {
  const daily = volume?.daily ?? [];
  const max = daily.reduce((m, d) => Math.max(m, d.volumeKg), 0);

  return (
    <View marginTop={14} testID="client-detail-daily-bars">
      <Text
        fontFamily="$display"
        fontSize={10.5}
        fontWeight="600"
        letterSpacing={1.7}
        textTransform="uppercase"
        color="$text3"
        marginBottom={8}
      >
        Daily activity
      </Text>
      {daily.length === 0 ? (
        <Text fontFamily="$body" fontSize={12} color="$text3">
          No sessions logged this week yet.
        </Text>
      ) : (
        <View flexDirection="row" alignItems="flex-end" gap={6} height={64}>
          {daily.map((d, i) => {
            const h = max > 0 ? Math.max(4, (d.volumeKg / max) * 50) : 4;
            return (
              <View key={`${d.date}-${i}`} flex={1} alignItems="center" gap={4}>
                <View
                  width="100%"
                  height={h}
                  backgroundColor={d.volumeKg > 0 ? "$primary" : "$surface4"}
                  borderRadius={3}
                />
                <Text
                  fontFamily="$display"
                  fontSize={9.5}
                  fontWeight="600"
                  color="$text3"
                >
                  {dayLetter(d.date)}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ── AdherenceBreakdown ───────────────────────────────────────────────────────
function AdherenceBreakdown({
  adherence,
}: {
  adherence: AdherenceModule | null;
}) {
  const overall = adherence?.overall ?? null;
  const band = adherence?.band ?? null;
  const categories = adherence?.categories ?? [];

  return (
    <Card pad={0} radius={16} testID="client-detail-adherence">
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        padding={16}
      >
        <View flexDirection="row" alignItems="center" gap={6}>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={18}
            color="$text"
          >
            Adherence
          </Text>
          <IconInfo size={13} color="#8A8A98" />
        </View>
        {overall != null && band != null ? (
          <View flexDirection="row" alignItems="baseline" gap={6}>
            <Text
              fontFamily="$mono"
              fontSize={22}
              fontWeight="700"
              color={toneHex(BAND_TONE[band]).base}
              testID="client-detail-adherence-overall"
            >
              {overall}%
            </Text>
            <Pill tone={BAND_TONE[band]} size="xs">
              {BAND_LABEL[band]}
            </Pill>
          </View>
        ) : (
          <Text
            fontFamily="$body"
            fontSize={12}
            color="$text3"
            testID="client-detail-adherence-empty"
          >
            Not enough data yet
          </Text>
        )}
      </View>

      {categories.map((cat) => (
        <View
          key={cat.label}
          padding={16}
          paddingVertical={10}
          borderTopWidth={1}
          borderColor="$border"
          testID={`client-detail-adherence-cat-${slug(cat.label)}`}
        >
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            marginBottom={6}
          >
            <View flex={1}>
              <Text
                fontFamily="$display"
                fontSize={13}
                fontWeight="500"
                color={cat.available ? "$text" : "$text3"}
              >
                {cat.label}
              </Text>
              <Text fontFamily="$body" fontSize={11} color="$text3">
                {cat.sub}
              </Text>
            </View>
            <Text
              fontFamily="$mono"
              fontSize={13}
              fontWeight="600"
              color={cat.available ? "$text2" : "$text3"}
            >
              {cat.available && cat.pct != null ? `${cat.pct}%` : "—"}
            </Text>
          </View>
          {cat.available && cat.pct != null ? (
            <Bar
              pct={cat.pct / 100}
              color={toneHex("primary").base}
              height={4}
            />
          ) : null}
        </View>
      ))}
    </Card>
  );
}

// ── ProgrammeSection (keeps the #166 block) ──────────────────────────────────
function ProgrammeSection({
  activeProgramme,
  onOpenProgramme,
  onAssignProgramme,
  onAssignWorkout,
  onManageHabits,
}: {
  activeProgramme: ActiveProgramme | null;
  onOpenProgramme: () => void;
  onAssignProgramme: () => void;
  onAssignWorkout: () => void;
  onManageHabits: () => void;
}) {
  return (
    <View gap={16}>
      <Section
        eyebrow="Programme"
        title="Training plan"
        testID="client-detail-programme"
      >
        {activeProgramme ? (
          <View gap={12}>
            <ProgrammeCard
              programName={activeProgramme.name}
              week={activeProgramme.week}
              totalWeeks={activeProgramme.totalWeeks}
              accent="trainer"
              onPress={onOpenProgramme}
              testID="client-detail-programme-card"
            />
            <Btn
              variant="ghost"
              tone="trainer"
              onPress={onAssignWorkout}
              testID="client-detail-assign-workout"
            >
              Assign a one-off workout
            </Btn>
          </View>
        ) : (
          <View gap={10}>
            <Text fontSize={13} color="$text3">
              No active programme — assign one to schedule this client&rsquo;s
              training.
            </Text>
            <Btn
              variant="soft"
              tone="trainer"
              onPress={onAssignProgramme}
              testID="client-detail-assign-programme"
            >
              Assign programme
            </Btn>
            <Btn
              variant="ghost"
              tone="trainer"
              onPress={onAssignWorkout}
              testID="client-detail-assign-workout"
            >
              Assign a one-off workout
            </Btn>
          </View>
        )}
      </Section>

      <Section
        eyebrow="Habits"
        title="Daily habits"
        testID="client-detail-habits"
      >
        <Btn
          variant="soft"
          tone="trainer"
          onPress={onManageHabits}
          testID="client-detail-manage-habits"
        >
          Manage habits
        </Btn>
      </Section>
    </View>
  );
}

// ── CoachNotesCard (Phase 12) ────────────────────────────────────────────────
function CoachNotesCard({
  notes,
  onAddNote,
  onEditNote,
}: {
  notes: ClientDetail["notes"];
  onAddNote: () => void;
  onEditNote: (note: ClientDetail["notes"][number]) => void;
}) {
  return (
    <Card pad={16} radius={16} testID="client-detail-notes">
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        marginBottom={10}
      >
        <View flexDirection="row" alignItems="center" gap={8}>
          <IconNote size={15} color="#8A8A98" />
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={18}
            color="$text"
          >
            Notes
          </Text>
          <Pill tone="neutral" size="xs">
            Private
          </Pill>
        </View>
        <IconBtn
          icon={<IconPlus size={14} strokeWidth={2.5} />}
          tone="ghost"
          size={28}
          onPress={onAddNote}
          accessibilityLabel="Add note"
          testID="client-detail-notes-add"
        />
      </View>

      {notes.length === 0 ? (
        <Text
          fontFamily="$body"
          fontSize={12.5}
          color="$text3"
          testID="client-detail-notes-empty"
        >
          No notes yet.
        </Text>
      ) : (
        <View gap={8}>
          {notes.map((n) => (
            <Pressable
              key={n.id}
              onPress={() => onEditNote(n)}
              testID={`client-detail-note-${n.id}`}
              accessibilityLabel="Edit note"
              style={{
                padding: 12,
                backgroundColor: "#1A1D29",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#232735",
              }}
            >
              <Text
                fontFamily="$display"
                fontSize={9.5}
                fontWeight="600"
                letterSpacing={0.95}
                textTransform="uppercase"
                color="$text3"
                marginBottom={3}
              >
                {shortDate(n.createdAt)}
              </Text>
              {n.title ? (
                <Text
                  fontFamily="$display"
                  fontSize={13}
                  fontWeight="600"
                  color="$text"
                  marginBottom={2}
                >
                  {n.title}
                </Text>
              ) : null}
              <Text
                fontFamily="$body"
                fontSize={12.5}
                lineHeight={18}
                color="$text2"
              >
                {n.content}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Missed = planned − completed this week, when both are known and positive. */
function missedCount(detail: ClientDetail | null): number | null {
  const tw = detail?.thisWeek;
  if (!tw || tw.workoutsPlanned == null) return null;
  const missed = tw.workoutsPlanned - tw.workoutsCompleted;
  return missed > 0 ? missed : 0;
}

function weightText(kg: number | null, unit: string | null): string {
  if (kg == null) return "—";
  const u = unit ?? "kg";
  return `${kg} ${u}`;
}

function dayLetter(dateISO: string): string {
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return "";
  return ["S", "M", "T", "W", "T", "F", "S"][d.getUTCDay()] ?? "";
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

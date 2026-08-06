/**
 * <MealprintPlanSheetPresenter> — "Plan my day" (spec-26 Phase 2, STORY-004).
 * One root-mounted sheet carrying config → generating → draft review → accept
 * → saved, mirroring `MealprintSuggestSheetPresenter`'s stage-machine shape
 * (see that file's docstring for the footer/scroll conventions this repeats).
 *
 * ## ⚠ No "include my saved recipes/meals" toggle
 *
 * The design source (`res1_application_javascript.txt` `AMPlanConfigSheet`)
 * and `specs/26-mealprint-meal-planning/design.md` § 3's endpoint table both
 * show one, but the SHIPPED `POST /nutrition/ai/plan-generate` schema
 * (`nutritionAiPlanGenerateHandler.ts`) has no `includeSaved` field — the
 * user's own recipes/meals are unconditionally pooled by
 * `listOwnRecipeCandidates`/`listOwnMealCandidates`, not gated behind a flag.
 * Wiring a toggle to nothing would be worse than omitting it; this is a
 * backend-contract gap (design/requirements ahead of what shipped), not a
 * mobile omission — see the build report.
 *
 * ## ⚠ The day-target line shows the FULL day target, not "remaining today"
 *
 * `nutritionAiPlanGenerateHandler`'s own docstring is explicit: "the candidate
 * pool is built against the FULL daily target… a plan is composed from
 * scratch for the whole day" — matching the design source's config sheet
 * (`AM_GOAL.kcal` — the goal, not `AM_REMAIN`, which only ever appears on the
 * SUGGEST sheet). Showing "remaining" here would claim the plan only covers
 * what's left today, which is not what the endpoint does.
 *
 * ## ⚠ No `flex: 1` in this body; the CTA is PINNED (`BottomSheet` `footer`)
 *
 * Same reasoning and same failure mode as `MealprintSuggestSheetPresenter` —
 * see that file's docstring. The draft stage in particular stacks day totals +
 * N meal cards + caveats, easily past the fold of an 86% sheet.
 */

import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import {
  BottomSheet,
  Btn,
  Card,
  IconBtn,
  Pill,
  Segmented,
  Stepper,
} from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconAlert,
  IconApple,
  IconCheck,
  IconEdit,
  IconMinus,
  IconPlus,
  IconSparkles,
  IconSwap,
  IconTrash,
} from "@/ui/components/icons";
import {
  EFFORT_LEVEL_LABELS,
  EFFORT_LEVELS,
  LABEL_CHECK_COPY,
  MAX_PLAN_ITEM_SERVINGS,
  MAX_STEER_LENGTH,
  MIN_PLAN_ITEM_SERVINGS,
  PLAN_ITEM_SERVINGS_STEP,
  type EffortLevel,
  type PlanDraft,
  type PlanGenerateEmptyReason,
  type PlanTarget,
} from "@/domain/models/mealprint";

const GOLD = toneHex("gold");
const AMBER = toneHex("gold");
const ERROR = toneHex("error");

export type MealprintPlanSheetStage =
  | "config"
  | "generating"
  | "draft"
  | "saved"
  | "error";

export type PlanAcceptRecovery = "replace" | "regenerate" | null;

export type MealprintPlanSheetProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly stage: MealprintPlanSheetStage;
  readonly offline: boolean;

  // Config
  readonly preferencesSummary: string | null;
  readonly mealsPerDay: number;
  readonly onMealsPerDayChange: (mealsPerDay: number) => void;
  readonly effortLevel: EffortLevel;
  readonly onEffortLevelChange: (effortLevel: EffortLevel) => void;
  readonly steer: string;
  readonly onSteerChange: (steer: string) => void;
  readonly dayTarget: PlanTarget | null;
  readonly emptyReason: PlanGenerateEmptyReason | null;
  readonly onGenerate: () => void;
  readonly onEditPreferences: () => void;

  // Draft
  readonly draft: PlanDraft | null;
  readonly flaggedIds: ReadonlySet<string>;
  readonly swappingId: string | null;
  readonly onSwapMeal: (localId: string) => void;
  readonly onRemoveMeal: (localId: string) => void;
  /** The per-item serving stepper's write path (AC 4.4/gap 2). */
  readonly onItemServingsChange: (
    localId: string,
    candidateId: string,
    servings: number,
  ) => void;
  readonly draftTotals: PlanTarget;
  readonly accepting: boolean;
  readonly acceptBlocked: boolean;
  readonly onAccept: () => void;
  readonly acceptErrorMessage: string | null;
  readonly acceptRecovery: PlanAcceptRecovery;
  readonly onAcceptRecovery: () => void;
  readonly labelCheckRequired: boolean;

  // Saved
  readonly onViewToday: () => void;

  // Generate-failure error stage
  readonly errorMessage: string | null;
  readonly errorRetryable: boolean;
  readonly errorIsEntitlement: boolean;
  readonly onRetryGenerate: () => void;
  readonly onUpgrade: () => void;

  readonly testID?: string;
};

const round = (value: number) => Math.round(value);

export function MealprintPlanSheetPresenter(props: MealprintPlanSheetProps) {
  const {
    visible,
    onClose,
    stage,
    offline,
    testID = "mealprint-plan-sheet",
  } = props;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Plan my day"
      eyebrow="MEALPRINT · PLAN"
      accent="gold"
      height={86}
      footer={resolveFooter(props)}
      testID={testID}
    >
      {offline && stage === "config" ? (
        <OfflineStage />
      ) : stage === "config" ? (
        <ConfigStage {...props} />
      ) : stage === "generating" ? (
        <GeneratingStage />
      ) : stage === "draft" ? (
        <DraftStage {...props} />
      ) : stage === "saved" ? (
        <SavedStage {...props} />
      ) : (
        <ErrorStage {...props} />
      )}
    </BottomSheet>
  );
}

function resolveFooter(props: MealprintPlanSheetProps) {
  const { stage, offline, draft } = props;
  if (stage === "config") {
    return offline ? undefined : <GenerateAction {...props} />;
  }
  if (stage === "draft" && draft !== null) {
    return <AcceptAction {...props} />;
  }
  if (stage === "saved") {
    return <ViewTodayAction {...props} />;
  }
  return undefined;
}

function GenerateAction({ onGenerate }: MealprintPlanSheetProps) {
  return (
    <Btn
      variant="filled"
      tone="gold"
      size="lg"
      full
      icon={<IconSparkles size={16} />}
      onPress={onGenerate}
      testID="mealprint-plan-generate"
    >
      Generate day plan
    </Btn>
  );
}

function AcceptAction({
  accepting,
  acceptBlocked,
  onAccept,
}: MealprintPlanSheetProps) {
  return (
    <Btn
      variant="filled"
      tone="gold"
      size="lg"
      full
      icon={<IconCheck size={16} strokeWidth={2.5} />}
      onPress={onAccept}
      disabled={accepting || acceptBlocked}
      testID="mealprint-plan-accept"
    >
      {accepting
        ? "Saving…"
        : acceptBlocked
          ? "Fix flagged meals to continue"
          : "Accept plan"}
    </Btn>
  );
}

function ViewTodayAction({ onViewToday }: MealprintPlanSheetProps) {
  return (
    <Btn
      variant="filled"
      tone="gold"
      size="lg"
      full
      icon={<IconApple size={15} />}
      onPress={onViewToday}
      testID="mealprint-plan-view-today"
    >
      View today&apos;s plan
    </Btn>
  );
}

function OfflineStage() {
  return (
    <View gap={12} paddingVertical={20} testID="mealprint-plan-offline">
      <StageIcon />
      <Text
        fontFamily="$display"
        fontWeight="700"
        fontSize={16}
        color="$text"
        textAlign="center"
      >
        You&apos;re offline
      </Text>
      <Text
        fontFamily="$body"
        fontSize={13}
        lineHeight={19}
        color="$text3"
        textAlign="center"
      >
        Plans need a connection to generate — your saved recipes still work
        offline.
      </Text>
    </View>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$display"
      fontSize={10.5}
      fontWeight="600"
      letterSpacing={1.5}
      textTransform="uppercase"
      color="$text3"
      paddingLeft={2}
    >
      {children}
    </Text>
  );
}

function Caveat({ text, testID }: { text: string; testID: string }) {
  return (
    <View
      flexDirection="row"
      gap={8}
      paddingHorizontal={12}
      paddingVertical={10}
      borderRadius={10}
      backgroundColor={AMBER.dim}
      borderWidth={1}
      borderColor="$border2"
      testID={testID}
    >
      <View paddingTop={1}>
        <IconAlert size={14} color={AMBER.base} />
      </View>
      <Text
        fontFamily="$body"
        fontSize={12}
        lineHeight={17.5}
        color="$text2"
        flex={1}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * Only ever rendered with the alert glyph in this sheet — unlike the suggest
 * sheet's equivalent, nothing here reaches a "sparkles" empty/offline state,
 * so there is no second glyph to parameterise.
 */
function StageIcon() {
  return (
    <View alignItems="center">
      <View
        width={56}
        height={56}
        borderRadius={28}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$goldDim"
        borderWidth={1}
        borderColor="$border2"
      >
        <IconAlert size={24} color={AMBER.base} />
      </View>
    </View>
  );
}

const EMPTY_COPY: Readonly<
  Record<PlanGenerateEmptyReason, { title: string; body: string }>
> = {
  no_targets: {
    title: "Set your targets first",
    body: "Mealprint builds a day of meals to hit your daily target — so it needs one to aim at.",
  },
  no_candidates: {
    title: "Nothing matched your preferences",
    body: "Your dietary pattern and avoid list rule out everything we can currently vouch for. Try removing an allergen or a dislike, or add a few of your own foods and recipes.",
  },
};

function ConfigStage(props: MealprintPlanSheetProps) {
  const {
    preferencesSummary,
    mealsPerDay,
    onMealsPerDayChange,
    effortLevel,
    onEffortLevelChange,
    steer,
    onSteerChange,
    dayTarget,
    emptyReason,
    onEditPreferences,
  } = props;

  return (
    <View gap={18}>
      {emptyReason !== null ? (
        <View gap={10} testID={`mealprint-plan-empty-${emptyReason}`}>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={15}
            color="$text"
          >
            {EMPTY_COPY[emptyReason].title}
          </Text>
          <Text
            fontFamily="$body"
            fontSize={12.5}
            lineHeight={18}
            color="$text2"
          >
            {EMPTY_COPY[emptyReason].body}
          </Text>
        </View>
      ) : null}

      <View gap={8}>
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Label>Your preferences</Label>
          <Pressable
            onPress={onEditPreferences}
            testID="mealprint-plan-edit-preferences"
            accessibilityRole="button"
            accessibilityLabel="Edit food preferences"
          >
            <View flexDirection="row" alignItems="center" gap={4}>
              <IconEdit size={12} color={GOLD.base} />
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={12}
                color="$gold"
              >
                Edit
              </Text>
            </View>
          </Pressable>
        </View>
        <Card pad={13} radius={13} testID="mealprint-plan-preferences-summary">
          <Text
            fontFamily="$body"
            fontSize={12.5}
            lineHeight={18}
            color="$text2"
          >
            {preferencesSummary ?? "No pattern · nothing avoided or liked yet"}
          </Text>
          {dayTarget ? (
            <View
              flexDirection="row"
              justifyContent="space-between"
              marginTop={10}
              paddingTop={10}
              borderTopWidth={1}
              borderColor="$border"
            >
              <Text fontFamily="$body" fontSize={11.5} color="$text3">
                {mealsPerDay} meals/day · {EFFORT_LEVEL_LABELS[effortLevel]}
              </Text>
              <Text
                fontFamily="$mono"
                fontSize={11.5}
                color="$text3"
                fontVariant={["tabular-nums"]}
              >
                {round(dayTarget.kcal).toLocaleString("en-US")} kcal target
              </Text>
            </View>
          ) : null}
        </Card>
      </View>

      <Stepper
        label="Meals per day"
        value={mealsPerDay}
        onDec={() => onMealsPerDayChange(Math.max(2, mealsPerDay - 1))}
        onInc={() => onMealsPerDayChange(Math.min(6, mealsPerDay + 1))}
        onType={(text) => {
          const parsed = Number(text);
          if (Number.isFinite(parsed)) {
            onMealsPerDayChange(Math.min(6, Math.max(2, Math.round(parsed))));
          }
        }}
        testID="mealprint-plan-meals-per-day"
      />

      <View gap={7}>
        <Label>Effort level</Label>
        <Segmented
          testID="mealprint-plan-effort"
          accent="gold"
          full
          options={EFFORT_LEVELS.map((level) => ({
            value: level,
            label: EFFORT_LEVEL_LABELS[level],
          }))}
          value={effortLevel}
          onChange={(value) => onEffortLevelChange(value as EffortLevel)}
        />
      </View>

      <View gap={7}>
        <Label>Anything specific? (optional)</Label>
        <View
          flexDirection="row"
          alignItems="center"
          gap={8}
          height={46}
          paddingHorizontal={12}
          borderRadius={12}
          backgroundColor="$surface3"
          borderWidth={1}
          borderColor="$border2"
        >
          <IconSparkles size={14} color="#8A8A98" />
          <TextInput
            value={steer}
            onChangeText={onSteerChange}
            placeholder="High protein breakfast, light dinner…"
            placeholderTextColor="#8A8A98"
            maxLength={MAX_STEER_LENGTH}
            returnKeyType="done"
            accessibilityLabel="Anything specific for this plan"
            testID="mealprint-plan-steer-input"
            style={{
              flex: 1,
              color: "#F4F4F8",
              fontFamily: "Geist",
              fontSize: 14,
              padding: 0,
            }}
          />
        </View>
      </View>
    </View>
  );
}

function GeneratingStage() {
  return (
    <View
      alignItems="center"
      justifyContent="center"
      gap={12}
      paddingVertical={56}
      testID="mealprint-plan-generating"
    >
      <View
        width={72}
        height={72}
        borderRadius={36}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$goldDim"
        borderWidth={1}
        borderColor="$goldGlow"
      >
        <IconSparkles size={30} color={GOLD.base} />
      </View>
      <Text fontFamily="$display" fontWeight="700" fontSize={17} color="$text">
        Building your day…
      </Text>
      <Text
        fontFamily="$body"
        fontSize={13}
        lineHeight={19}
        color="$text3"
        textAlign="center"
      >
        Fitting your meals to your target and preferences. This can take up to
        20 seconds.
      </Text>
    </View>
  );
}

function DayTotalsCard({
  totals,
  target,
}: {
  totals: PlanTarget;
  target: PlanTarget;
}) {
  const pct = target.kcal <= 0 ? 0 : Math.min(1, totals.kcal / target.kcal);
  return (
    <Card pad={16} radius={16} accent="gold" testID="mealprint-plan-day-totals">
      <View
        flexDirection="row"
        alignItems="baseline"
        justifyContent="space-between"
        marginBottom={10}
      >
        <Label>Day total vs target</Label>
        <View flexDirection="row" alignItems="baseline" gap={4}>
          <Text fontFamily="$mono" fontWeight="600" fontSize={20} color="$text">
            {round(totals.kcal).toLocaleString("en-US")}
          </Text>
          <Text fontFamily="$mono" fontSize={12} color="$text3">
            / {round(target.kcal).toLocaleString("en-US")} kcal
          </Text>
        </View>
      </View>
      <View
        height={6}
        borderRadius={3}
        backgroundColor="$surface3"
        overflow="hidden"
      >
        <View
          height={6}
          borderRadius={3}
          width={`${Math.round(pct * 100)}%`}
          backgroundColor="$gold"
        />
      </View>
      <View flexDirection="row" gap={8} marginTop={10}>
        {(
          [
            ["Protein", totals.proteinG, target.proteinG],
            ["Carbs", totals.carbsG, target.carbsG],
            ["Fat", totals.fatG, target.fatG],
          ] as const
        ).map(([label, value, goal]) => (
          <View key={label} flex={1}>
            <View
              flexDirection="row"
              justifyContent="space-between"
              marginBottom={4}
            >
              <Text fontSize={10.5} color="$text3">
                {label}
              </Text>
              <Text fontFamily="$mono" fontSize={10.5} color="$text2">
                {round(value)}/{round(goal)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

function ItemServingsStepper({
  localId,
  candidateId,
  servings,
  disabled,
  onChange,
}: {
  localId: string;
  candidateId: string;
  servings: number;
  disabled: boolean;
  onChange: (servings: number) => void;
}) {
  const testID = `mealprint-plan-item-servings-${localId}-${candidateId}`;
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={3}
      opacity={disabled ? 0.45 : 1}
    >
      <IconBtn
        icon={<IconMinus size={9} strokeWidth={2.5} />}
        tone="ghost"
        size={20}
        disabled={disabled}
        onPress={() =>
          onChange(
            Math.max(
              MIN_PLAN_ITEM_SERVINGS,
              servings - PLAN_ITEM_SERVINGS_STEP,
            ),
          )
        }
        accessibilityLabel="Decrease servings"
        testID={`${testID}-dec`}
      />
      <Text
        fontFamily="$mono"
        fontSize={11}
        color="$text2"
        minWidth={26}
        textAlign="center"
        testID={testID}
      >
        {formatServings(servings)}
      </Text>
      <IconBtn
        icon={<IconPlus size={9} strokeWidth={2.5} />}
        tone="ghost"
        size={20}
        disabled={disabled}
        onPress={() =>
          onChange(
            Math.min(
              MAX_PLAN_ITEM_SERVINGS,
              servings + PLAN_ITEM_SERVINGS_STEP,
            ),
          )
        }
        accessibilityLabel="Increase servings"
        testID={`${testID}-inc`}
      />
    </View>
  );
}

function PlanMealCard({
  localId,
  meal,
  flagged,
  swapping,
  onSwap,
  onRemove,
  onItemServingsChange,
}: {
  localId: string;
  meal: PlanDraft["meals"][number]["meal"];
  flagged: boolean;
  swapping: boolean;
  onSwap: () => void;
  onRemove: () => void;
  onItemServingsChange: (candidateId: string, servings: number) => void;
}) {
  return (
    <Card
      pad={0}
      radius={16}
      accent={flagged ? "error" : undefined}
      testID={`mealprint-plan-meal-${localId}`}
    >
      <View padding={14}>
        <View flexDirection="row" alignItems="center" gap={8} marginBottom={8}>
          <Pill tone="gold" size="xs">
            {meal.logSlot.toUpperCase()}
          </Pill>
          {flagged ? (
            <>
              <IconAlert size={11} color={ERROR.base} />
              <Pill tone="error" size="xs">
                CHECK
              </Pill>
            </>
          ) : null}
        </View>
        <View
          flexDirection="row"
          alignItems="flex-start"
          justifyContent="space-between"
          gap={10}
        >
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={15}
            color="$text"
            flex={1}
          >
            {meal.name}
          </Text>
          <View alignItems="flex-end" flexShrink={0}>
            <Text
              fontFamily="$mono"
              fontWeight="600"
              fontSize={19}
              color="$gold"
            >
              {round(meal.kcal)}
            </Text>
            <Text
              fontFamily="$display"
              fontSize={8.5}
              fontWeight="600"
              color="$text3"
            >
              KCAL
            </Text>
          </View>
        </View>

        {flagged ? (
          <View
            flexDirection="row"
            gap={8}
            alignItems="center"
            marginTop={10}
            padding={10}
            borderRadius={10}
            backgroundColor={ERROR.dim}
            borderWidth={1}
            borderColor="$border2"
          >
            <IconAlert size={14} color={ERROR.base} />
            <Text fontSize={11.5} color="$text" lineHeight={16} flex={1}>
              This meal needs a swap before you can accept.
            </Text>
          </View>
        ) : (
          <View
            flexDirection="row"
            gap={7}
            alignItems="flex-start"
            marginTop={10}
          >
            <IconSparkles size={12} color={GOLD.base} />
            <Text fontSize={11.5} lineHeight={16} color="$text2" flex={1}>
              {meal.reason}
            </Text>
          </View>
        )}

        <View gap={6} paddingTop={10}>
          {meal.items.map((item, index) => (
            <View
              key={`${item.candidateId}-${index}`}
              flexDirection="row"
              alignItems="center"
              gap={8}
            >
              <View
                width={4}
                height={4}
                borderRadius={2}
                backgroundColor="$text4"
              />
              <Text fontSize={12} color="$text3" flex={1} numberOfLines={1}>
                {item.name}
              </Text>
              <ItemServingsStepper
                localId={localId}
                candidateId={item.candidateId}
                servings={item.servings}
                disabled={flagged || swapping}
                onChange={(servings) =>
                  onItemServingsChange(item.candidateId, servings)
                }
              />
            </View>
          ))}
        </View>
      </View>

      <View flexDirection="row" borderTopWidth={1} borderColor="$border">
        <Pressable
          onPress={onSwap}
          disabled={swapping}
          testID={`mealprint-plan-meal-swap-${localId}`}
          accessibilityRole="button"
          accessibilityLabel={`Swap ${meal.name}`}
          style={{
            flex: 1,
            padding: 11,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <IconSwap size={13} color={GOLD.base} />
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={12.5}
            color="$gold"
          >
            {swapping ? "Swapping…" : "Swap"}
          </Text>
        </Pressable>
        <Pressable
          onPress={onRemove}
          disabled={swapping}
          testID={`mealprint-plan-meal-remove-${localId}`}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${meal.name}`}
          style={{
            flex: 1,
            padding: 11,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            borderLeftWidth: 1,
            borderLeftColor: "rgba(255,255,255,0.08)",
          }}
        >
          <IconTrash size={13} color="#A0A0AC" />
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={12.5}
            color="$text2"
          >
            Remove
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

function DraftStage(props: MealprintPlanSheetProps) {
  const {
    draft,
    flaggedIds,
    swappingId,
    onSwapMeal,
    onRemoveMeal,
    onItemServingsChange,
    draftTotals,
    acceptErrorMessage,
    acceptRecovery,
    onAcceptRecovery,
    labelCheckRequired,
  } = props;

  if (draft === null) return null;

  return (
    <View gap={14} testID="mealprint-plan-draft">
      <DayTotalsCard totals={draftTotals} target={draft.target} />

      {acceptErrorMessage ? (
        <View
          gap={8}
          padding={12}
          borderRadius={12}
          backgroundColor={ERROR.dim}
          borderWidth={1}
          borderColor="$border2"
          testID="mealprint-plan-accept-error"
        >
          <Text fontSize={12} color="$text" lineHeight={17}>
            {acceptErrorMessage}
          </Text>
          {acceptRecovery !== null ? (
            <Pressable
              onPress={onAcceptRecovery}
              testID="mealprint-plan-accept-recovery"
              accessibilityRole="button"
            >
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={12.5}
                color="$gold"
              >
                {acceptRecovery === "replace"
                  ? "Replace today's plan"
                  : "Start over"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {draft.meals.length === 0 ? (
        <Text
          fontSize={13}
          color="$text3"
          textAlign="center"
          paddingVertical={20}
        >
          Every meal was removed — start over to generate a new plan.
        </Text>
      ) : (
        draft.meals.map(({ localId, meal }) => (
          <PlanMealCard
            key={localId}
            localId={localId}
            meal={meal}
            flagged={flaggedIds.has(localId)}
            swapping={swappingId === localId}
            onSwap={() => onSwapMeal(localId)}
            onRemove={() => onRemoveMeal(localId)}
            onItemServingsChange={(candidateId, servings) =>
              onItemServingsChange(localId, candidateId, servings)
            }
          />
        ))
      )}

      {labelCheckRequired ? (
        <Caveat
          text={LABEL_CHECK_COPY}
          testID="mealprint-plan-label-check-disclaimer"
        />
      ) : null}
    </View>
  );
}

function SavedStage(_props: MealprintPlanSheetProps) {
  return (
    <View
      alignItems="center"
      gap={16}
      paddingVertical={40}
      testID="mealprint-plan-saved"
    >
      <View
        width={76}
        height={76}
        borderRadius={22}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$gold"
      >
        <IconCheck size={38} strokeWidth={2.5} color="#141414" />
      </View>
      <Text fontFamily="$display" fontWeight="700" fontSize={20} color="$text">
        Plan added to Fuel
      </Text>
      <Text
        fontFamily="$body"
        fontSize={13.5}
        lineHeight={20}
        color="$text2"
        textAlign="center"
        maxWidth={280}
      >
        Your meals show as planned rows in today&apos;s log. Nothing is logged
        until you confirm each one.
      </Text>
    </View>
  );
}

function ErrorStage({
  errorMessage,
  errorRetryable,
  errorIsEntitlement,
  onRetryGenerate,
  onUpgrade,
  onClose,
}: MealprintPlanSheetProps) {
  return (
    <View gap={16} testID="mealprint-plan-error">
      <Text fontFamily="$body" fontSize={14} lineHeight={20} color="$text2">
        {errorMessage ?? "Couldn't reach Mealprint."}
      </Text>
      {errorIsEntitlement ? (
        <Btn
          variant="filled"
          tone="gold"
          size="lg"
          full
          onPress={onUpgrade}
          testID="mealprint-plan-error-upgrade"
        >
          See Premium+
        </Btn>
      ) : errorRetryable ? (
        <Btn
          variant="filled"
          tone="gold"
          size="lg"
          full
          onPress={onRetryGenerate}
          testID="mealprint-plan-error-retry"
        >
          Try again
        </Btn>
      ) : (
        <Btn
          variant="outline"
          tone="gold"
          size="md"
          full
          onPress={onClose}
          testID="mealprint-plan-error-dismiss"
        >
          Close
        </Btn>
      )}
    </View>
  );
}

function formatServings(servings: number): string {
  return Number(servings.toFixed(2)).toString();
}

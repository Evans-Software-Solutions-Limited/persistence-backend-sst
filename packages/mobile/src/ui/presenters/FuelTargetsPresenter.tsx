/**
 * <FuelTargetsPresenter> — the Fuel → Targets TDEE calculator (M9 PR3).
 * Ports `~/Downloads/handoff/design-source/screens/fuel-targets.jsx`: a
 * sticky live kcal/macro preview, a read-only profile strip, 5 activity
 * chips, a cut↔bulk goal slider, and a macro editor (the prototype's 5
 * preset chips: Recommended/High protein/Balanced/Low carb/Custom).
 *
 * Deliberate deviations from the literal prototype, each decided in the
 * spec, not ad hoc (see `specs/13-nutrition-tracking/design.md § Risks`,
 * `requirements.md` STORY-004):
 *  - the 3 macro sliders are fully independent (no auto-rebalance-on-drag);
 *    a split that doesn't sum to 100% shows a warning chip and blocks Save,
 *    rather than being silently corrected;
 *  - a CALORIE-MODE toggle (Calculator / Set my own, Brad-requested
 *    2026-07-02): manual mode swaps the profile/activity/goal calculator for
 *    a direct kcal input while the macro-split editor keeps working
 *    identically. Not in the prototype at all.
 *
 * Pure presenter — all bmr/tdee/kcal/macro math is computed by the container
 * via `nutrition.service`'s `computeFuelTargetsPreview` and passed down as
 * already-derived numbers; this file only formats them for display (the
 * `Math.round`/`toLocaleString` calls below are presentation, not business
 * logic — same convention as `WeeklyVolumePresenter`).
 *
 * Spec: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § Fuel Targets screen (PR 3)
 *       specs/13-nutrition-tracking/requirements.md STORY-004
 */

import { Pressable, ScrollView, StyleSheet, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";

import {
  Btn,
  Card,
  HeaderBar,
  IconBtn,
  Pill,
} from "@/ui/components/foundation";
import { toneHex, type Tone } from "@/ui/components/foundation/tones";
import { LinearSlider } from "@/ui/components/foundation/LinearSlider";
import {
  IconDroplet,
  IconInfo,
  IconMinus,
  IconPlus,
  IconX,
} from "@/ui/components/icons";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { color } from "@/ui/theme/tokens";
import {
  ACTIVITY_LEVELS,
  MANUAL_KCAL_MAX,
  MANUAL_KCAL_MIN,
  macroSplitSumsTo100,
  type ActivityLevel,
  type CalorieMode,
  type GoalLabel,
  type MacroPresetMode,
  type MacroSplit,
} from "@/domain/services/nutrition.service";
import type { ProfileGender } from "@/domain/models/profilePage";

export type FuelTargetsPresenterProps = {
  isLoadingInitial: boolean;
  isSaving: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSave: () => void;

  /** "Coach Bradley" style, when the current server target was set by a
   * trainer (`setByName` non-null). Null hides the banner. */
  trainerName: string | null;

  age: number | null;
  gender: ProfileGender | null;
  heightCm: number | null;
  weightKg: number | null;
  onOpenProfile: () => void;

  /** Calculator vs direct kcal entry — manual swaps the profile/activity/
   * goal sections for a single kcal input; macros work identically. */
  calorieMode: CalorieMode;
  onCalorieModeChange: (mode: CalorieMode) => void;
  /** Raw text of the manual kcal input (container-owned, clearable). */
  manualKcalText: string;
  onManualKcalTextChange: (text: string) => void;

  /** Null when the profile is incomplete (no bmr → no kcal to show), or
   * when the manual kcal is absent/out of range. */
  tdee: number | null;
  kcal: number | null;
  goalLabelInfo: GoalLabel;
  macroSplit: MacroSplit;
  macroGrams: { proteinG: number; carbsG: number; fatG: number } | null;

  activityId: ActivityLevel["id"];
  onActivityChange: (id: ActivityLevel["id"]) => void;

  goal: number;
  onGoalChange: (goal: number) => void;

  macroMode: MacroPresetMode;
  onMacroModeChange: (mode: MacroPresetMode) => void;
  onProteinPctChange: (pct: number) => void;
  onCarbsPctChange: (pct: number) => void;
  onFatPctChange: (pct: number) => void;

  /** Daily water goal in cups (STORY-004 AC 4.2). */
  waterCups: number;
  onWaterCupsChange: (cups: number) => void;

  testID?: string;
};

export function FuelTargetsPresenter({
  isLoadingInitial,
  isSaving,
  errorMessage,
  onCancel,
  onSave,
  trainerName,
  age,
  gender,
  heightCm,
  weightKg,
  onOpenProfile,
  calorieMode,
  onCalorieModeChange,
  manualKcalText,
  onManualKcalTextChange,
  tdee,
  kcal,
  goalLabelInfo,
  macroSplit,
  macroGrams,
  activityId,
  onActivityChange,
  goal,
  onGoalChange,
  macroMode,
  onMacroModeChange,
  onProteinPctChange,
  onCarbsPctChange,
  onFatPctChange,
  waterCups,
  onWaterCupsChange,
  testID = "fuel-targets-screen",
}: FuelTargetsPresenterProps) {
  const insets = useSafeAreaInsets();
  const splitValid = macroSplitSumsTo100(macroSplit);
  const canSave = !isSaving && splitValid && kcal !== null;

  if (isLoadingInitial) {
    return (
      <View
        flex={1}
        backgroundColor="$bg"
        alignItems="center"
        justifyContent="center"
        paddingTop={insets.top}
        testID={testID}
      >
        <PLogoDrawLoader />
      </View>
    );
  }

  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID={testID}
    >
      <HeaderBar
        title="Set targets"
        leading={
          <Pressable
            onPress={onCancel}
            disabled={isSaving}
            testID="fuel-targets-cancel"
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              opacity: pressed ? 0.7 : 1,
              paddingVertical: 6,
            })}
          >
            <IconX size={18} color={color.$text2} />
            <Text fontFamily="$body" fontSize={13.5} color="$text2">
              Cancel
            </Text>
          </Pressable>
        }
        trailing={
          <Btn
            variant="filled"
            tone="primary"
            size="sm"
            onPress={onSave}
            disabled={!canSave}
            testID="fuel-targets-save"
          >
            {isSaving ? "Saving…" : "Save"}
          </Btn>
        }
      />

      <StickyPreview
        kcal={kcal}
        tdee={tdee}
        goal={goal}
        goalLabelInfo={goalLabelInfo}
        macroSplit={macroSplit}
        macroGrams={macroGrams}
        manual={calorieMode === "manual"}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 40 + insets.bottom,
          gap: 18,
        }}
        showsVerticalScrollIndicator={false}
      >
        {errorMessage ? (
          <View
            paddingHorizontal={14}
            paddingVertical={10}
            borderRadius={12}
            backgroundColor="$errorDim"
            borderWidth={1}
            borderColor="$error"
            testID="fuel-targets-error"
          >
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$error"
              textAlign="center"
            >
              {errorMessage}
            </Text>
          </View>
        ) : null}

        {trainerName ? <TrainerAttributionBanner name={trainerName} /> : null}

        <CalorieModeToggle value={calorieMode} onChange={onCalorieModeChange} />

        {calorieMode === "manual" ? (
          <ManualKcalSection
            text={manualKcalText}
            kcal={kcal}
            onChange={onManualKcalTextChange}
          />
        ) : (
          <>
            <ProfileStrip
              age={age}
              gender={gender}
              heightCm={heightCm}
              weightKg={weightKg}
              onOpenProfile={onOpenProfile}
            />

            <ActivityChips value={activityId} onChange={onActivityChange} />

            <GoalSliderSection
              value={goal}
              onChange={onGoalChange}
              label={goalLabelInfo}
              kcal={kcal}
              tdee={tdee}
            />
          </>
        )}

        <MacroEditorSection
          mode={macroMode}
          onModeChange={onMacroModeChange}
          split={macroSplit}
          grams={macroGrams}
          splitValid={splitValid}
          onProteinPctChange={onProteinPctChange}
          onCarbsPctChange={onCarbsPctChange}
          onFatPctChange={onFatPctChange}
        />

        <WaterGoalSection cups={waterCups} onChange={onWaterCupsChange} />
      </ScrollView>
    </View>
  );
}

// ── Trainer attribution banner ──────────────────────────────────────────────

function TrainerAttributionBanner({ name }: { name: string }) {
  return (
    <Card
      pad={12}
      radius={12}
      accent="trainer"
      testID="fuel-targets-trainer-banner"
    >
      <View flexDirection="row" alignItems="center" gap={8}>
        <IconInfo size={14} color={color.$accentTrainer} />
        <Text fontFamily="$body" fontSize={12.5} color="$text2" flex={1}>
          Targets set by{" "}
          <Text fontWeight="600" color="$text">
            {name}
          </Text>
        </Text>
      </View>
    </Card>
  );
}

// ── Sticky preview ───────────────────────────────────────────────────────

function StickyPreview({
  kcal,
  tdee,
  goal,
  goalLabelInfo,
  macroSplit,
  macroGrams,
  manual,
}: {
  kcal: number | null;
  tdee: number | null;
  goal: number;
  goalLabelInfo: GoalLabel;
  macroSplit: MacroSplit;
  macroGrams: { proteinG: number; carbsG: number; fatG: number } | null;
  manual: boolean;
}) {
  const incomplete = kcal === null || macroGrams === null;
  const deltaKcal = incomplete ? null : Math.round(kcal! - (tdee ?? kcal!));
  const subLine = manual
    ? deltaKcal === null
      ? "Enter a calorie target"
      : "Your own target"
    : deltaKcal === null
      ? "Complete your profile"
      : `${deltaKcal >= 0 ? "+" : ""}${deltaKcal} kcal · TDEE ${Math.round(tdee ?? 0)}`;

  return (
    <LinearGradient
      colors={[color.$goldGlow, color.$surface]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.previewContainer}
      testID="fuel-targets-preview"
    >
      <View
        flexDirection="row"
        alignItems="flex-end"
        justifyContent="space-between"
        gap={12}
        marginBottom={12}
      >
        <View flexShrink={1}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
            marginBottom={4}
          >
            DAILY TARGET
          </Text>
          <View flexDirection="row" alignItems="baseline" gap={6}>
            <Text
              fontFamily="$display"
              fontWeight="800"
              fontSize={32}
              letterSpacing={-1}
              color="$text"
              testID="fuel-targets-kcal"
            >
              {kcal === null ? "—" : kcal.toLocaleString()}
            </Text>
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$text3"
              fontWeight="600"
            >
              kcal
            </Text>
          </View>
        </View>
        <View alignItems="flex-end" flexShrink={0}>
          {manual ? (
            <Pill tone="gold" size="xs" testID="fuel-targets-manual-pill">
              MANUAL
            </Pill>
          ) : (
            <Pill tone={goalLabelInfo.tone as Tone} size="xs">
              {goalLabelInfo.name.toUpperCase()}
            </Pill>
          )}
          <Text fontFamily="$body" fontSize={10.5} color="$text3" marginTop={4}>
            {subLine}
          </Text>
        </View>
      </View>

      {!incomplete && (
        <>
          <View
            flexDirection="row"
            height={26}
            borderRadius={7}
            overflow="hidden"
            borderWidth={1}
            borderColor="$border"
            marginBottom={6}
          >
            <MacroBarSegment
              pct={macroSplit.proteinPct}
              color={color.$primary}
              label="P"
            />
            <MacroBarSegment
              pct={macroSplit.carbsPct}
              color={color.$gold}
              label="C"
            />
            <MacroBarSegment
              pct={macroSplit.fatPct}
              color={color.$ember}
              label="F"
            />
          </View>
          <View flexDirection="row" justifyContent="space-between">
            <MacroBarLabel
              color={color.$primary}
              label="Protein"
              grams={macroGrams!.proteinG}
            />
            <MacroBarLabel
              color={color.$gold}
              label="Carbs"
              grams={macroGrams!.carbsG}
            />
            <MacroBarLabel
              color={color.$ember}
              label="Fat"
              grams={macroGrams!.fatG}
            />
          </View>
        </>
      )}
    </LinearGradient>
  );
}

function MacroBarSegment({
  pct,
  color: segColor,
  label,
}: {
  pct: number;
  color: string;
  label: string;
}) {
  return (
    <View
      flex={Math.max(pct, 0.001)}
      backgroundColor={segColor}
      alignItems="center"
      justifyContent="center"
    >
      <Text fontFamily="$display" fontSize={10.5} fontWeight="700" color="$bg">
        {label}
      </Text>
    </View>
  );
}

function MacroBarLabel({
  color: dotColor,
  label,
  grams,
}: {
  color: string;
  label: string;
  grams: number;
}) {
  return (
    <View flexDirection="row" alignItems="center" gap={5}>
      <View
        width={6}
        height={6}
        borderRadius={1.5}
        style={{ backgroundColor: dotColor }}
      />
      <Text
        fontFamily="$display"
        fontSize={9}
        fontWeight="600"
        letterSpacing={0.5}
        textTransform="uppercase"
        color="$text3"
      >
        {label}
      </Text>
      <Text fontFamily="$body" fontSize={11} fontWeight="600" color="$text2">
        {grams}g
      </Text>
    </View>
  );
}

// ── Profile strip ─────────────────────────────────────────────────────────

function ProfileStrip({
  age,
  gender,
  heightCm,
  weightKg,
  onOpenProfile,
}: {
  age: number | null;
  gender: ProfileGender | null;
  heightCm: number | null;
  weightKg: number | null;
  onOpenProfile: () => void;
}) {
  const genderLabel =
    gender === "male"
      ? "M"
      : gender === "female"
        ? "F"
        : gender === "other"
          ? "—"
          : "—";

  return (
    <View>
      <View
        flexDirection="row"
        alignItems="flex-end"
        justifyContent="space-between"
        marginBottom={8}
      >
        <Text
          fontFamily="$display"
          fontSize={10.5}
          fontWeight="600"
          letterSpacing={1.7}
          textTransform="uppercase"
          color="$text3"
        >
          FROM PROFILE
        </Text>
        <Pressable
          onPress={onOpenProfile}
          testID="fuel-targets-open-profile"
          accessibilityRole="button"
          accessibilityLabel="Update your profile"
        >
          <Text fontFamily="$body" fontSize={11} color="$text3">
            Update in settings
          </Text>
        </Pressable>
      </View>
      <Card pad={0} radius={12} style={{ overflow: "hidden" }}>
        <View flexDirection="row">
          <StripField label="AGE" value={age === null ? "—" : String(age)} />
          <StripField label="SEX" value={genderLabel} border />
          <StripField
            label="HEIGHT"
            value={heightCm === null ? "—" : `${Math.round(heightCm)}`}
            unit="cm"
            border
          />
          <StripField
            label="WEIGHT"
            value={weightKg === null ? "—" : weightKg.toFixed(1)}
            unit="kg"
            border
          />
        </View>
      </Card>
    </View>
  );
}

function StripField({
  label,
  value,
  unit,
  border,
}: {
  label: string;
  value: string;
  unit?: string;
  border?: boolean;
}) {
  return (
    <View
      flex={1}
      paddingVertical={10}
      paddingHorizontal={8}
      borderLeftWidth={border ? 1 : 0}
      borderLeftColor="$border"
    >
      <Text
        fontFamily="$display"
        fontSize={9}
        fontWeight="600"
        letterSpacing={0.5}
        textTransform="uppercase"
        color="$text3"
        marginBottom={3}
      >
        {label}
      </Text>
      <View flexDirection="row" alignItems="baseline" gap={2}>
        <Text
          fontFamily="$body"
          fontSize={16}
          fontWeight="600"
          letterSpacing={-0.4}
          color="$text"
        >
          {value}
        </Text>
        {unit ? (
          <Text fontFamily="$body" fontSize={10} color="$text3">
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ── Activity chips ────────────────────────────────────────────────────────

function ActivityChips({
  value,
  onChange,
}: {
  value: ActivityLevel["id"];
  onChange: (id: ActivityLevel["id"]) => void;
}) {
  const current = ACTIVITY_LEVELS.find((a) => a.id === value);
  return (
    <View>
      <SectionHead
        title="Activity"
        sub="How much you move on an average week"
      />
      <View flexDirection="row" gap={5}>
        {ACTIVITY_LEVELS.map((a) => {
          const selected = a.id === value;
          return (
            <Pressable
              key={a.id}
              onPress={() => onChange(a.id)}
              testID={`fuel-targets-activity-${a.id}`}
              style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.8 : 1 })}
            >
              <View
                paddingVertical={10}
                paddingHorizontal={4}
                borderRadius={10}
                backgroundColor={selected ? "$primaryDim" : "$surface2"}
                borderWidth={1}
                borderColor={selected ? "$primary" : "$border"}
                alignItems="center"
                gap={3}
              >
                <Text
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={11.5}
                  color={selected ? "$primary" : "$text2"}
                >
                  {a.label}
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={9}
                  color={selected ? "$primary" : "$text3"}
                >
                  ×{a.mult}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text
        fontFamily="$body"
        fontSize={11}
        color="$text3"
        marginTop={6}
        paddingHorizontal={4}
      >
        {current?.sub} · TDEE will adjust accordingly
      </Text>
    </View>
  );
}

// ── Goal slider ───────────────────────────────────────────────────────────

function GoalSliderSection({
  value,
  onChange,
  label,
  kcal,
  tdee,
}: {
  value: number;
  onChange: (goal: number) => void;
  label: GoalLabel;
  kcal: number | null;
  tdee: number | null;
}) {
  return (
    <View>
      <View
        flexDirection="row"
        alignItems="flex-end"
        justifyContent="space-between"
        marginBottom={10}
      >
        <View>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
          >
            GOAL
          </Text>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={20}
            color="$text"
          >
            {label.name}
          </Text>
          <Text fontFamily="$body" fontSize={11.5} color="$text3" marginTop={2}>
            {label.sub}
          </Text>
        </View>
      </View>

      <LinearSlider
        min={-1}
        max={1}
        step={0.05}
        value={value}
        onValueChange={onChange}
        height={24}
        thumbSize={22}
        thumbBorderWidth={3}
        thumbBorderColor={toneHex(label.tone as Tone).base}
        glow
        testID="fuel-targets-goal-slider"
        accessibilityLabel="Goal: cut to bulk"
        trackBackground={
          <LinearGradient
            colors={[
              color.$ember,
              color.$primary,
              color.$success,
              color.$gold,
              color.$gold7,
            ]}
            locations={[0, 0.35, 0.5, 0.65, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              height: 6,
              top: 9,
              borderRadius: 3,
              opacity: 0.85,
            }}
          />
        }
      />
      <View flexDirection="row" justifyContent="space-between" marginTop={6}>
        <Text
          fontFamily="$display"
          fontSize={9}
          fontWeight="600"
          letterSpacing={0.5}
          color="$ember"
        >
          CUT
        </Text>
        <Text
          fontFamily="$display"
          fontSize={9}
          fontWeight="600"
          letterSpacing={0.5}
          color="$success"
        >
          MAINTAIN
        </Text>
        <Text
          fontFamily="$display"
          fontSize={9}
          fontWeight="600"
          letterSpacing={0.5}
          color="$gold"
        >
          BULK
        </Text>
      </View>
    </View>
  );
}

// ── Macro editor ──────────────────────────────────────────────────────────

const PRESET_CHIPS: { id: MacroPresetMode; label: string }[] = [
  { id: "recommended", label: "Recommended" },
  { id: "high_protein", label: "High protein" },
  { id: "balanced", label: "Balanced" },
  { id: "low_carb", label: "Low carb" },
  { id: "custom", label: "Custom" },
];

function MacroEditorSection({
  mode,
  onModeChange,
  split,
  grams,
  splitValid,
  onProteinPctChange,
  onCarbsPctChange,
  onFatPctChange,
}: {
  mode: MacroPresetMode;
  onModeChange: (mode: MacroPresetMode) => void;
  split: MacroSplit;
  grams: { proteinG: number; carbsG: number; fatG: number } | null;
  splitValid: boolean;
  onProteinPctChange: (pct: number) => void;
  onCarbsPctChange: (pct: number) => void;
  onFatPctChange: (pct: number) => void;
}) {
  const disabled = mode !== "custom";
  return (
    <View>
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        marginBottom={10}
      >
        <SectionHead title="Macros" sub="Tap a preset or customise" />
        {!splitValid ? (
          <Pill tone="error" size="xs" testID="fuel-targets-split-warning">
            ≠ 100%
          </Pill>
        ) : null}
      </View>

      <View flexDirection="row" gap={5} marginBottom={12} flexWrap="wrap">
        {PRESET_CHIPS.map((chip) => {
          const selected = chip.id === mode;
          return (
            <Pressable
              key={chip.id}
              onPress={() => onModeChange(chip.id)}
              testID={`fuel-targets-macro-mode-${chip.id}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
            >
              <View
                height={30}
                paddingHorizontal={12}
                borderRadius={999}
                alignItems="center"
                justifyContent="center"
                backgroundColor={selected ? "$primary" : "$surface2"}
                borderWidth={1}
                borderColor={selected ? "$primary" : "$border"}
              >
                <Text
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={11.5}
                  color={selected ? "$primaryInk" : "$text2"}
                >
                  {chip.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Card pad={14} radius={12} testID="fuel-targets-macro-sliders">
        <MacroSliderRow
          label="Protein"
          color={color.$primary}
          value={split.proteinPct}
          grams={grams?.proteinG ?? 0}
          kcalPerG={4}
          disabled={disabled}
          onChange={onProteinPctChange}
          testID="fuel-targets-protein-slider"
        />
        <View borderTopWidth={1} borderTopColor="$border" marginVertical={10} />
        <MacroSliderRow
          label="Carbs"
          color={color.$gold}
          value={split.carbsPct}
          grams={grams?.carbsG ?? 0}
          kcalPerG={4}
          disabled={disabled}
          onChange={onCarbsPctChange}
          testID="fuel-targets-carbs-slider"
        />
        <View borderTopWidth={1} borderTopColor="$border" marginVertical={10} />
        <MacroSliderRow
          label="Fat"
          color={color.$ember}
          value={split.fatPct}
          grams={grams?.fatG ?? 0}
          kcalPerG={9}
          disabled={disabled}
          onChange={onFatPctChange}
          testID="fuel-targets-fat-slider"
        />
      </Card>
    </View>
  );
}

function MacroSliderRow({
  label,
  color: rowColor,
  value,
  grams,
  kcalPerG,
  disabled,
  onChange,
  testID,
}: {
  label: string;
  color: string;
  value: number;
  grams: number;
  kcalPerG: number;
  disabled: boolean;
  onChange: (pct: number) => void;
  testID: string;
}) {
  return (
    <View style={{ opacity: disabled ? 0.85 : 1 }}>
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        marginBottom={8}
      >
        <View flexDirection="row" alignItems="center" gap={8}>
          <View
            width={8}
            height={8}
            borderRadius={2}
            style={{ backgroundColor: rowColor }}
          />
          <Text fontFamily="$body" fontSize={13} fontWeight="600" color="$text">
            {label}
          </Text>
        </View>
        <View flexDirection="row" alignItems="baseline" gap={5}>
          <Text fontFamily="$body" fontSize={14} fontWeight="600" color="$text">
            {value}
            <Text fontSize={9} color="$text3">
              %
            </Text>
          </Text>
          <Text fontFamily="$body" fontSize={11} color="$text2">
            {grams}
            <Text color="$text3">g</Text>
          </Text>
          <Text fontFamily="$body" fontSize={10} color="$text3">
            {grams * kcalPerG} kcal
          </Text>
        </View>
      </View>
      <LinearSlider
        min={0}
        max={100}
        step={1}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        height={20}
        trackHeight={4}
        fillColor={rowColor}
        thumbSize={16}
        thumbBorderWidth={2}
        thumbBorderColor={rowColor}
        testID={testID}
        accessibilityLabel={`${label} percentage`}
      />
    </View>
  );
}

// ── Water goal ────────────────────────────────────────────────────────────
// STORY-004 AC 4.2 — not in the design-source prototype (`fuel-targets.jsx`
// has no water field at all), but required by the spec/smoke-test and by
// `SetTargetsInput.waterCups` (a mandatory field on save). A minimal cups
// stepper consistent with the app's existing droplet iconography.

const MIN_WATER_CUPS = 1;
const MAX_WATER_CUPS = 20;

function WaterGoalSection({
  cups,
  onChange,
}: {
  cups: number;
  onChange: (cups: number) => void;
}) {
  return (
    <View>
      <SectionHead title="Water goal" sub="Cups per day" />
      <Card pad={14} radius={12}>
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <View flexDirection="row" alignItems="center" gap={8}>
            <IconDroplet size={18} color={color.$primary} />
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={18}
              color="$text"
              testID="fuel-targets-water-cups"
            >
              {cups} cups
            </Text>
          </View>
          <View flexDirection="row" alignItems="center" gap={10}>
            <IconBtn
              icon={<IconMinus size={14} />}
              tone="neutral"
              size={32}
              disabled={cups <= MIN_WATER_CUPS}
              onPress={() => onChange(Math.max(MIN_WATER_CUPS, cups - 1))}
              accessibilityLabel="Decrease water goal"
              testID="fuel-targets-water-minus"
            />
            <IconBtn
              icon={<IconPlus size={14} />}
              tone="neutral"
              size={32}
              disabled={cups >= MAX_WATER_CUPS}
              onPress={() => onChange(Math.min(MAX_WATER_CUPS, cups + 1))}
              accessibilityLabel="Increase water goal"
              testID="fuel-targets-water-plus"
            />
          </View>
        </View>
      </Card>
    </View>
  );
}

// ── Shared ────────────────────────────────────────────────────────────────

// ── Calorie mode toggle + manual kcal input ─────────────────────────────────

const CALORIE_MODES: { id: CalorieMode; label: string; sub: string }[] = [
  { id: "calculated", label: "Calculator", sub: "From your profile" },
  { id: "manual", label: "Set my own", sub: "Type a kcal target" },
];

function CalorieModeToggle({
  value,
  onChange,
}: {
  value: CalorieMode;
  onChange: (mode: CalorieMode) => void;
}) {
  return (
    <View flexDirection="row" gap={5}>
      {CALORIE_MODES.map((m) => {
        const selected = m.id === value;
        return (
          <Pressable
            key={m.id}
            onPress={() => onChange(m.id)}
            testID={`fuel-targets-calorie-mode-${m.id}`}
            style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.8 : 1 })}
          >
            <View
              paddingVertical={10}
              paddingHorizontal={4}
              borderRadius={10}
              backgroundColor={selected ? "$primaryDim" : "$surface2"}
              borderWidth={1}
              borderColor={selected ? "$primary" : "$border"}
              alignItems="center"
              gap={3}
            >
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={11.5}
                color={selected ? "$primary" : "$text2"}
              >
                {m.label}
              </Text>
              <Text
                fontFamily="$body"
                fontSize={9}
                color={selected ? "$primary" : "$text3"}
              >
                {m.sub}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function ManualKcalSection({
  text,
  kcal,
  onChange,
}: {
  text: string;
  /** The container's validated preview kcal — null while absent/out of range. */
  kcal: number | null;
  onChange: (text: string) => void;
}) {
  const outOfRange = text.trim() !== "" && kcal === null;
  return (
    <View>
      <SectionHead
        title="Daily calories"
        sub="Your macros still follow the split below"
      />
      <Card pad={16} radius={12} style={{ marginTop: 10 }}>
        <View
          flexDirection="row"
          alignItems="baseline"
          justifyContent="center"
          gap={6}
        >
          <TextInput
            value={text}
            onChangeText={onChange}
            inputMode="numeric"
            placeholder="—"
            placeholderTextColor="#8A8A98"
            accessibilityLabel="Daily calorie target"
            testID="fuel-targets-manual-kcal-input"
            style={{
              minWidth: 120,
              textAlign: "right",
              color: "#F4F4F8",
              fontFamily: "Geist Mono",
              fontWeight: "600",
              fontSize: 40,
              letterSpacing: -1.5,
              padding: 0,
            }}
          />
          <Text fontFamily="$mono" color="$text3" fontSize={15}>
            kcal
          </Text>
        </View>
      </Card>
      {outOfRange ? (
        <Text
          fontFamily="$body"
          fontSize={11.5}
          color="$error"
          marginTop={6}
          paddingHorizontal={4}
          testID="fuel-targets-manual-kcal-warning"
        >
          Enter between {MANUAL_KCAL_MIN.toLocaleString()} and{" "}
          {MANUAL_KCAL_MAX.toLocaleString()} kcal.
        </Text>
      ) : null}
    </View>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <View flexDirection="row" alignItems="baseline" gap={8}>
      <Text fontFamily="$display" fontWeight="700" fontSize={16} color="$text">
        {title}
      </Text>
      {sub ? (
        <Text fontFamily="$body" fontSize={11.5} color="$text3">
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  previewContainer: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.$border,
  },
});

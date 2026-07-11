import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { toneHex } from "@/ui/components/foundation/tones";
import { useEditNutritionTargetsSheet } from "@/state/edit-nutrition-targets-sheet";
import { useAdapters } from "@/ui/hooks/useAdapters";
import type { SetTargetsInput } from "@/domain/models/nutrition";
import {
  ACTIVITY_LEVELS,
  type ActivityLevel,
  computeFuelTargetsPreview,
  DEFAULT_ACTIVITY_ID,
  goalLabel,
  MACRO_PRESETS,
  type MacroPresetMode,
  recommendedSplit,
  type Sex,
} from "@/domain/services/nutrition.service";

/**
 * <EditNutritionTargetsSheet> — the coach sets a client's daily kcal + macros
 * on their behalf (M8 Coach Phase 5). Root-mounted; opened from Client Detail
 * with the client fixed. Writes via `PUT /trainers/me/clients/:id/nutrition/
 * target` (`api.setClientNutritionTarget`). Direct online call, like the
 * assign-workout flow.
 *
 * Two modes:
 *  - "manual" (default) — the coach types kcal + macros directly. Unchanged
 *    from Phase 5.
 *  - "calculator" — the coach works the client's calories out with the SAME
 *    Mifflin-St Jeor TDEE engine the athlete uses on the Fuel Targets screen
 *    (`computeFuelTargetsPreview`). Age + height prefill from the Client Detail
 *    header; the coach adds the client's sex + weight, picks an activity level,
 *    goal and macro split, and the computed targets are what's saved. Goal /
 *    activity / macro are chip pickers rather than the athlete's sliders — a
 *    continuous drag inside a bottom sheet fights the sheet's pan gesture.
 *
 * Fidelity note: the prototype's TargetsCard is a display grid with a per-tile
 * pencil, not an edit form — there is no macros-edit sheet in the prototype.
 * This sheet is one of the brief's stated Phase-5 deltas (QuickActionsRow
 * "Macros" + TargetsCard edit), so it follows the app's existing sheet chrome
 * (AssignWorkoutSheet) rather than a prototype layout.
 */

type Mode = "manual" | "calculator";

/** Parse a non-negative integer from a text field, or null when blank/invalid. */
export function parseTargetField(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

/**
 * Parse a positive (decimal-allowed) number for the calculator's body-stat
 * fields — weight is naturally fractional (72.5 kg), so unlike the whole-number
 * target fields these accept a decimal. Null on blank/invalid/≤0.
 */
export function parseBodyStat(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const FIELDS: {
  key: "dailyKcal" | "proteinG" | "carbsG" | "fatG" | "waterCups";
  label: string;
  unit: string;
}[] = [
  { key: "dailyKcal", label: "Calories", unit: "kcal / day" },
  { key: "proteinG", label: "Protein", unit: "g / day" },
  { key: "carbsG", label: "Carbs", unit: "g / day" },
  { key: "fatG", label: "Fat", unit: "g / day" },
  { key: "waterCups", label: "Water", unit: "cups / day" },
];

const SEX_OPTIONS: { id: Sex; label: string }[] = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "other", label: "Other" },
];

/** Goal-slider stops rendered as chips (cut ↔ bulk). The values line up with
 *  `goalLabel`'s thresholds so each chip reads its own label. */
const GOAL_OPTIONS: number[] = [-1, -0.5, 0, 0.5, 1];

const MACRO_MODE_OPTIONS: {
  id: Exclude<MacroPresetMode, "custom">;
  label: string;
}[] = [
  { id: "recommended", label: "Recommended" },
  ...MACRO_PRESETS.map((p) => ({ id: p.id, label: p.label })),
];

const INPUT_STYLE = {
  height: 44,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "#232735",
  backgroundColor: "#1A1D29",
  paddingHorizontal: 14,
  color: "#F4F4F8",
  fontSize: 14,
} as const;

/** Uppercase section label, matching the sheet's other field labels. */
function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$display"
      fontSize={10.5}
      fontWeight="600"
      letterSpacing={1.7}
      textTransform="uppercase"
      color="$text3"
    >
      {children}
    </Text>
  );
}

/** A selectable pill, trainer-accented when active (ports AssignGoalSheet). */
function Chip({
  label,
  sub,
  selected,
  onPress,
  testID,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: selected ? toneHex("trainer").base : "#232735",
        backgroundColor: selected ? toneHex("trainer").dim : "#1A1D29",
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <Text
        fontFamily="$display"
        fontWeight="600"
        fontSize={13}
        color={selected ? "$accentTrainer" : "$text"}
      >
        {label}
      </Text>
      {sub ? (
        <Text fontFamily="$body" fontSize={11} color="$text3" marginTop={1}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function EditNutritionTargetsSheet() {
  const open = useEditNutritionTargetsSheet((s) => s.open);
  const clientId = useEditNutritionTargetsSheet((s) => s.clientId);
  const initial = useEditNutritionTargetsSheet((s) => s.initial);
  const onSaved = useEditNutritionTargetsSheet((s) => s.onSaved);
  const closeSheet = useEditNutritionTargetsSheet((s) => s.closeSheet);

  const { api } = useAdapters();

  const [mode, setMode] = useState<Mode>("manual");

  // Manual mode fields.
  const [dailyKcal, setDailyKcal] = useState("");
  const [proteinG, setProteinG] = useState("");
  const [carbsG, setCarbsG] = useState("");
  const [fatG, setFatG] = useState("");
  const [waterCups, setWaterCups] = useState("");

  // Calculator fields.
  const [sex, setSex] = useState<Sex | null>(null);
  const [ageText, setAgeText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [weightText, setWeightText] = useState("");
  const [activityId, setActivityId] =
    useState<ActivityLevel["id"]>(DEFAULT_ACTIVITY_ID);
  const [goal, setGoal] = useState(0);
  const [macroMode, setMacroMode] =
    useState<Exclude<MacroPresetMode, "custom">>("recommended");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const values: Record<(typeof FIELDS)[number]["key"], string> = {
    dailyKcal,
    proteinG,
    carbsG,
    fatG,
    waterCups,
  };
  const setters: Record<(typeof FIELDS)[number]["key"], (v: string) => void> = {
    dailyKcal: setDailyKcal,
    proteinG: setProteinG,
    carbsG: setCarbsG,
    fatG: setFatG,
    waterCups: setWaterCups,
  };

  // Seed from the aggregate's module d when the sheet opens; reset on close.
  useEffect(() => {
    if (!open) {
      setError(null);
      setSubmitting(false);
      return;
    }
    const asText = (n: number | null | undefined) =>
      n == null ? "" : String(n);
    setMode("manual");
    setDailyKcal(asText(initial?.dailyKcal));
    setProteinG(asText(initial?.proteinG));
    setCarbsG(asText(initial?.carbsG));
    setFatG(asText(initial?.fatG));
    setWaterCups(asText(initial?.waterCups));
    // Calculator prefill — age + height come from the client header; the coach
    // adds sex + weight (not on the header).
    setSex(null);
    setAgeText(asText(initial?.ageYears));
    setHeightText(asText(initial?.heightCm));
    setWeightText("");
    setActivityId(DEFAULT_ACTIVITY_ID);
    setGoal(0);
    setMacroMode("recommended");
    setError(null);
    setSubmitting(false);
  }, [open, initial]);

  // Manual payload — every field required + a non-negative integer (the backend
  // validator `t.Number({ minimum: 0 })` rejects partial / negative bodies).
  // Non-null iff all five parse, which is exactly what gates Save in manual
  // mode — no `preset` key here, so the manual write is byte-for-byte unchanged.
  const manualPayload = useMemo<SetTargetsInput | null>(() => {
    const nums = [dailyKcal, proteinG, carbsG, fatG, waterCups].map(
      parseTargetField,
    );
    if (nums.some((v) => v === null)) return null;
    return {
      dailyKcal: nums[0] as number,
      proteinG: nums[1] as number,
      carbsG: nums[2] as number,
      fatG: nums[3] as number,
      waterCups: nums[4] as number,
    };
  }, [dailyKcal, proteinG, carbsG, fatG, waterCups]);

  // Calculator preview — the SAME derivation the athlete's Fuel Targets screen
  // runs. `custom` macro mode is never selectable here, so the customSplit arg
  // is an unused placeholder.
  const preview = useMemo(
    () =>
      computeFuelTargetsPreview(
        {
          sex,
          age: parseBodyStat(ageText),
          heightCm: parseBodyStat(heightText),
          weightKg: parseBodyStat(weightText),
        },
        activityId,
        goal,
        macroMode,
        recommendedSplit(goal),
      ),
    [sex, ageText, heightText, weightText, activityId, goal, macroMode],
  );

  // Calculator payload — the computed kcal/macros plus a manually-entered water
  // target (water isn't part of TDEE). `preset` records which macro split was
  // used, mirroring the athlete save path.
  const calcPayload = useMemo<SetTargetsInput | null>(() => {
    const water = parseTargetField(waterCups);
    if (preview.kcal === null || preview.macroGrams === null || water === null)
      return null;
    return {
      dailyKcal: preview.kcal,
      proteinG: preview.macroGrams.proteinG,
      carbsG: preview.macroGrams.carbsG,
      fatG: preview.macroGrams.fatG,
      waterCups: water,
      preset: macroMode,
    };
  }, [preview, waterCups, macroMode]);

  const activePayload = mode === "manual" ? manualPayload : calcPayload;
  const canSave = clientId !== null && activePayload !== null && !submitting;

  const handleSave = useCallback(async () => {
    if (!canSave || clientId === null || activePayload === null) return;
    setError(null);
    setSubmitting(true);
    const result = await api.setClientNutritionTarget(clientId, activePayload);
    setSubmitting(false);
    if (result.ok) {
      onSaved?.();
      closeSheet();
      return;
    }
    setError("Couldn't save the targets. Please try again.");
  }, [api, canSave, clientId, activePayload, onSaved, closeSheet]);

  return (
    <BottomSheet
      visible={open}
      onClose={closeSheet}
      title="Edit targets"
      accent="trainer"
      height="tall"
    >
      <View gap={16} testID="edit-nutrition-targets-sheet">
        {/* Mode toggle — type the numbers in, or work them out. */}
        <View flexDirection="row" gap={8}>
          <View flex={1}>
            <Chip
              label="Manual"
              selected={mode === "manual"}
              onPress={() => setMode("manual")}
              testID="edit-nutrition-mode-manual"
            />
          </View>
          <View flex={1}>
            <Chip
              label="Calculator"
              selected={mode === "calculator"}
              onPress={() => setMode("calculator")}
              testID="edit-nutrition-mode-calculator"
            />
          </View>
        </View>

        {mode === "manual" ? (
          FIELDS.map((f) => (
            <View key={f.key} gap={8}>
              <SectionLabel>{`${f.label} · ${f.unit}`}</SectionLabel>
              <TextInput
                value={values[f.key]}
                onChangeText={setters[f.key]}
                placeholder="0"
                placeholderTextColor="#8A8A98"
                keyboardType="number-pad"
                autoCorrect={false}
                testID={`edit-target-${f.key}`}
                style={INPUT_STYLE}
              />
            </View>
          ))
        ) : (
          <View gap={16} testID="edit-nutrition-calculator">
            {/* Sex */}
            <View gap={8}>
              <SectionLabel>Sex</SectionLabel>
              <View flexDirection="row" gap={8}>
                {SEX_OPTIONS.map((o) => (
                  <View key={o.id} flex={1}>
                    <Chip
                      label={o.label}
                      selected={sex === o.id}
                      onPress={() => setSex(o.id)}
                      testID={`edit-calc-sex-${o.id}`}
                    />
                  </View>
                ))}
              </View>
            </View>

            {/* Age / Height / Weight */}
            <View flexDirection="row" gap={8}>
              <View flex={1} gap={8}>
                <SectionLabel>Age · yrs</SectionLabel>
                <TextInput
                  value={ageText}
                  onChangeText={setAgeText}
                  placeholder="—"
                  placeholderTextColor="#8A8A98"
                  keyboardType="number-pad"
                  autoCorrect={false}
                  testID="edit-calc-age"
                  style={INPUT_STYLE}
                />
              </View>
              <View flex={1} gap={8}>
                <SectionLabel>Height · cm</SectionLabel>
                <TextInput
                  value={heightText}
                  onChangeText={setHeightText}
                  placeholder="—"
                  placeholderTextColor="#8A8A98"
                  keyboardType="numeric"
                  autoCorrect={false}
                  testID="edit-calc-height"
                  style={INPUT_STYLE}
                />
              </View>
              <View flex={1} gap={8}>
                <SectionLabel>Weight · kg</SectionLabel>
                <TextInput
                  value={weightText}
                  onChangeText={setWeightText}
                  placeholder="—"
                  placeholderTextColor="#8A8A98"
                  keyboardType="numeric"
                  autoCorrect={false}
                  testID="edit-calc-weight"
                  style={INPUT_STYLE}
                />
              </View>
            </View>

            {/* Activity */}
            <View gap={8}>
              <SectionLabel>Activity</SectionLabel>
              <View flexDirection="row" flexWrap="wrap" gap={8}>
                {ACTIVITY_LEVELS.map((a) => (
                  <Chip
                    key={a.id}
                    label={a.label}
                    sub={a.sub}
                    selected={activityId === a.id}
                    onPress={() => setActivityId(a.id)}
                    testID={`edit-calc-activity-${a.id}`}
                  />
                ))}
              </View>
            </View>

            {/* Goal */}
            <View gap={8}>
              <SectionLabel>Goal</SectionLabel>
              <View flexDirection="row" flexWrap="wrap" gap={8}>
                {GOAL_OPTIONS.map((g) => (
                  <Chip
                    key={g}
                    label={goalLabel(g).name}
                    selected={goal === g}
                    onPress={() => setGoal(g)}
                    testID={`edit-calc-goal-${g}`}
                  />
                ))}
              </View>
            </View>

            {/* Macro split */}
            <View gap={8}>
              <SectionLabel>Macro split</SectionLabel>
              <View flexDirection="row" flexWrap="wrap" gap={8}>
                {MACRO_MODE_OPTIONS.map((m) => (
                  <Chip
                    key={m.id}
                    label={m.label}
                    selected={macroMode === m.id}
                    onPress={() => setMacroMode(m.id)}
                    testID={`edit-calc-macro-${m.id}`}
                  />
                ))}
              </View>
            </View>

            {/* Live preview */}
            {preview.kcal !== null && preview.macroGrams !== null ? (
              <View
                gap={6}
                padding={14}
                borderRadius={14}
                borderWidth={1}
                borderColor="$surface3"
                backgroundColor="$surface2"
                testID="edit-calc-preview"
              >
                <Text
                  fontFamily="$display"
                  fontWeight="700"
                  fontSize={22}
                  color="$text"
                  testID="edit-calc-preview-kcal"
                >
                  {preview.kcal} kcal / day
                </Text>
                <Text fontFamily="$body" fontSize={13} color="$text2">
                  P {preview.macroGrams.proteinG}g · C{" "}
                  {preview.macroGrams.carbsG}g · F {preview.macroGrams.fatG}g
                </Text>
                {preview.tdee !== null ? (
                  <Text fontFamily="$body" fontSize={11} color="$text3">
                    {goalLabel(goal).name} · maintenance ~
                    {Math.round(preview.tdee)} kcal
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text
                fontFamily="$body"
                fontSize={13}
                color="$text3"
                testID="edit-calc-incomplete"
              >
                Add the client’s sex, age, height and weight to calculate their
                targets.
              </Text>
            )}

            {/* Water — not part of the TDEE calculation. */}
            <View gap={8}>
              <SectionLabel>Water · cups / day</SectionLabel>
              <TextInput
                value={waterCups}
                onChangeText={setWaterCups}
                placeholder="0"
                placeholderTextColor="#8A8A98"
                keyboardType="number-pad"
                autoCorrect={false}
                testID="edit-calc-water"
                style={INPUT_STYLE}
              />
            </View>
          </View>
        )}

        {error ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$error"
            testID="edit-nutrition-targets-error"
          >
            {error}
          </Text>
        ) : null}

        <Btn
          variant="filled"
          tone="trainer"
          disabled={!canSave}
          onPress={handleSave}
          testID="edit-nutrition-targets-submit"
        >
          {submitting ? "Saving…" : "Save targets"}
        </Btn>
      </View>
    </BottomSheet>
  );
}

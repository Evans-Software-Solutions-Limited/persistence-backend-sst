/**
 * <FuelTargetsContainer> — wires the profile + nutrition-target hooks into
 * the pure <FuelTargetsPresenter> (M9 PR3, STORY-004).
 *
 * Reopening restores what the athlete chose last time (PER-97, 26 Oct user
 * feedback: "the calculator resets every time"). Sex, age, height and weight
 * come from the profile and the latest weigh-in. `nutrition_targets` persists
 * only the RESULT (kcal/macros/water/preset), so the calculator's own inputs
 * (activity, goal, calorie mode + typed kcal, macro mode + custom split) are
 * saved per account on this device at Save (`state/fuel-calculator-inputs`)
 * and read back on open. With no device record (another device, or targets
 * saved before the fix) the saved target's preset — and for "custom" its
 * gram-derived split — restores the macro section; activity and goal can't
 * be derived from a result and start at their defaults. `waterCups` is
 * hydrated from the saved target as before.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";

import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useDashboard } from "@/ui/hooks/useDashboard";
import { useGetNutritionTarget } from "@/ui/hooks/useGetNutritionTarget";
import { useGetBodyMeasurements } from "@/ui/hooks/useGetBodyMeasurements";
import { useSetTargets } from "@/ui/hooks/useSetTargets";
import { useMealprintPreferences } from "@/ui/hooks/useMealprintPreferences";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";
import { summarisePreferences } from "@/domain/models/mealprint";
import { useFuelSheets } from "@/state/fuel-sheets";
import {
  loadFuelCalculatorInputs,
  macroInputsFromTarget,
  saveFuelCalculatorInputs,
  type FuelCalculatorInputs,
} from "@/state/fuel-calculator-inputs";
import { useAuth } from "@/ui/hooks/useAuth";
import { computeAge, localDayISO, preferredVolumeUnit } from "@/shared/utils";
import {
  computeFuelTargetsPreview,
  computeManualFuelTargetsPreview,
  DEFAULT_ACTIVITY_ID,
  macroSplitSumsTo100,
  presetSplit,
  recommendedSplit,
  type ActivityLevel,
  type CalorieMode,
  type MacroPresetMode,
  type MacroSplit,
} from "@/domain/services/nutrition.service";
import { useFuelProfileEditor } from "@/ui/hooks/useFuelProfileEditor";
import { FuelProfileEditor } from "@/ui/presenters/FuelProfileEditor";
import { WeighInSheetContainer } from "./WeighInSheetContainer";
import { FuelTargetsPresenter } from "@/ui/presenters/FuelTargetsPresenter";

const DEFAULT_WATER_CUPS = 8;
const DEFAULT_GOAL = 0;
const DEFAULT_MACRO_MODE: MacroPresetMode = "recommended";

/**
 * `onboarding` marks the `(onboarding)/fuel-targets` mount. The root layout
 * renders a `<Slot/>`, so ANY push into `(app)` from there unmounts the
 * journey and throws away `HabitSetupContainer`'s unsaved habit draft — the
 * exact failure the detour route exists to avoid. So on that mount the two
 * links out are withheld rather than pointed somewhere; see the docstring on
 * `app/(onboarding)/fuel-targets.tsx`.
 */
export function FuelTargetsContainer({
  onboarding = false,
}: { onboarding?: boolean } = {}) {
  const router = useRouter();
  const userId = useAuth().session?.userId ?? null;
  const profilePage = useProfilePage();
  // Device-QA #5/#7 — the water goal's display unit follows the user's
  // `preferredUnits`, defaulting to litres. `ProfilePageProfile` has no
  // `preferredUnits` field (it carries the independent weightUnit/heightUnit
  // instead), so this reuses the dashboard payload (already cached for Home)
  // rather than adding a new field to the profile-page contract.
  const dashboard = useDashboard();
  const volumeUnit = preferredVolumeUnit(
    dashboard.payload?.profile.preferredUnits,
  );
  const target = useGetNutritionTarget();
  const body = useGetBodyMeasurements(30);
  const { mutate: setTargets } = useSetTargets();
  const mealprintGate = useMealprintGate();
  // spec-26 AC 1.1 — the "Food preferences" row's summary. Fetch only while
  // Mealprint remains entitled; cached preferences are masked during a lapse.
  const mealprintPreferences = useMealprintPreferences(mealprintGate.allowed);
  const foodPreferencesSummary = summarisePreferences(
    mealprintPreferences.data,
  );
  const notifyFuelMutated = useFuelSheets((s) => s.notifyMutated);

  const [activityId, setActivityId] =
    useState<ActivityLevel["id"]>(DEFAULT_ACTIVITY_ID);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [calorieMode, setCalorieMode] = useState<CalorieMode>("calculated");
  // Raw text backing the manual-kcal input (the presenter renders it
  // verbatim). Tracked as TEXT, not a parsed number, for the same reason as
  // the weigh-in fields (PR #144): deriving the input's value from a parsed
  // number makes the field impossible to clear mid-edit.
  const [manualKcalText, setManualKcalText] = useState("");
  const [macroMode, setMacroMode] =
    useState<MacroPresetMode>(DEFAULT_MACRO_MODE);
  const [customSplit, setCustomSplit] = useState<MacroSplit>(
    recommendedSplit(DEFAULT_GOAL),
  );
  const [waterCups, setWaterCups] = useState(DEFAULT_WATER_CUPS);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // PER-97 — reopen on the inputs the athlete last saved. The device record
  // (activity, goal, calorie mode, split) wins; without one (another device,
  // or targets saved before this fix) the saved target's preset and grams
  // restore the macro split. Any edit made before either read lands latches
  // `inputsTouchedRef`, so a late read never overwrites the athlete's change.
  const inputsTouchedRef = useRef(false);
  const [storedInputs, setStoredInputs] = useState<
    FuelCalculatorInputs | null | undefined
  >(undefined);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadFuelCalculatorInputs(userId).then((saved) => {
      if (cancelled) return;
      setStoredInputs(saved ?? null);
      if (!saved || inputsTouchedRef.current) return;
      inputsTouchedRef.current = true;
      setActivityId(saved.activityId);
      setGoal(saved.goal);
      setCalorieMode(saved.calorieMode);
      setManualKcalText(saved.manualKcalText);
      setMacroMode(saved.macroMode);
      setCustomSplit(saved.customSplit);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  useEffect(() => {
    if (storedInputs !== null || inputsTouchedRef.current) return;
    const restored = macroInputsFromTarget(target.data);
    if (!restored) return;
    inputsTouchedRef.current = true;
    setMacroMode(restored.macroMode);
    if (restored.customSplit) setCustomSplit(restored.customSplit);
  }, [storedInputs, target.data]);
  const touchInputs = useCallback(() => {
    inputsTouchedRef.current = true;
  }, []);

  // One-shot: carry over the water goal from an existing target once it's
  // resolved (cache-first, so this often fires synchronously on mount; on a
  // cache-miss `target.data` starts null and the real value can arrive later
  // via the background fetch). A ref (not state) guards it so a later
  // refetch/refresh doesn't clobber a value the user has since changed in
  // this session — `target.data === null` on the FIRST render just means
  // "not resolved yet" here, not "confirmed no target", so it must not latch
  // the ref by itself. Latching only happens once we actually hydrate, or
  // once the user makes their own edit (`onWaterCupsChange` below) — a
  // manual edit always wins over a late-arriving fetch.
  const waterHydratedRef = useRef(false);
  useEffect(() => {
    if (waterHydratedRef.current) return;
    if (target.data === null) return;
    waterHydratedRef.current = true;
    setWaterCups(target.data.waterCups);
  }, [target.data]);

  const onWaterCupsChange = useCallback((cups: number) => {
    waterHydratedRef.current = true;
    setWaterCups(cups);
  }, []);

  const profile = profilePage.payload?.profile ?? null;
  // `profile.weightKg` is a static snapshot that nothing in the app ever
  // writes — weight is logged via the weigh-in flow into `cached_body_trend`,
  // never back onto the profile row. Sourcing from the latest body
  // measurement instead means a weigh-in logged from Home actually feeds the
  // TDEE calculator; the profile field is kept only as a defensive fallback
  // for the (currently unused) direct-write path.
  const latestWeightKg = useMemo(() => {
    const points = body.data ?? [];
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (points[i].weightKg != null) return points[i].weightKg;
    }
    return null;
  }, [body.data]);
  const quickProfile = useFuelProfileEditor(
    profile,
    latestWeightKg ?? profile?.weightKg ?? null,
  );
  const age = computeAge(quickProfile.profile?.dateOfBirth ?? null);
  const gender = quickProfile.profile?.gender ?? null;
  const heightCm = quickProfile.profile?.heightCm ?? null;
  const weightKg = quickProfile.weightKg;

  const manualKcal = useMemo(() => {
    const parsed = parseFloat(manualKcalText);
    return Number.isNaN(parsed) ? null : parsed;
  }, [manualKcalText]);

  const preview = useMemo(
    () =>
      calorieMode === "manual"
        ? computeManualFuelTargetsPreview(
            manualKcal,
            goal,
            macroMode,
            customSplit,
          )
        : computeFuelTargetsPreview(
            { sex: gender, age, heightCm, weightKg },
            activityId,
            goal,
            macroMode,
            customSplit,
          ),
    [
      calorieMode,
      manualKcal,
      gender,
      age,
      heightCm,
      weightKg,
      activityId,
      goal,
      macroMode,
      customSplit,
    ],
  );

  // Switching INTO manual mode with an empty field seeds it from the number
  // already on screen (the live calculated kcal), falling back to the saved
  // target — "start from the calculation, then tweak" — so the user edits a
  // concrete value instead of a blank box. Only when empty: a value the user
  // typed earlier in this session survives toggling back and forth.
  const onCalorieModeChange = useCallback(
    (mode: CalorieMode) => {
      touchInputs();
      if (mode === "manual" && manualKcalText === "") {
        const seed = preview.kcal ?? target.data?.dailyKcal ?? null;
        if (seed !== null) setManualKcalText(String(seed));
      }
      setCalorieMode(mode);
    },
    [manualKcalText, preview.kcal, target.data, touchInputs],
  );
  const onManualKcalTextChange = useCallback(
    (text: string) => {
      touchInputs();
      setManualKcalText(text);
    },
    [touchInputs],
  );
  const onActivityChange = useCallback(
    (id: ActivityLevel["id"]) => {
      touchInputs();
      setActivityId(id);
    },
    [touchInputs],
  );
  const onGoalChange = useCallback(
    (next: number) => {
      touchInputs();
      setGoal(next);
    },
    [touchInputs],
  );

  // Switching INTO Custom mode snapshots whatever split was effectively
  // showing (the just-left preset's fixed values) so the sliders start where
  // the user left off rather than some stale prior customSplit. Switching
  // between two fixed presets (or back out of Custom) needs no snapshot —
  // each fixed preset's split is a pure constant lookup.
  const onMacroModeChange = useCallback(
    (nextMode: MacroPresetMode) => {
      touchInputs();
      if (nextMode === "custom" && macroMode !== "custom") {
        setCustomSplit(presetSplit(macroMode, goal));
      }
      setMacroMode(nextMode);
    },
    [macroMode, goal, touchInputs],
  );

  const onProteinPctChange = useCallback(
    (pct: number) => {
      touchInputs();
      setCustomSplit((prev) => ({ ...prev, proteinPct: pct }));
    },
    [touchInputs],
  );
  const onCarbsPctChange = useCallback(
    (pct: number) => {
      touchInputs();
      setCustomSplit((prev) => ({ ...prev, carbsPct: pct }));
    },
    [touchInputs],
  );
  const onFatPctChange = useCallback(
    (pct: number) => {
      touchInputs();
      setCustomSplit((prev) => ({ ...prev, fatPct: pct }));
    },
    [touchInputs],
  );

  const onCancel = useCallback(() => {
    router.back();
  }, [router]);

  const onOpenProfile = useCallback(() => {
    if (onboarding) return;
    router.push("/(app)/profile/edit");
  }, [onboarding, router]);

  const onSave = useCallback(async () => {
    // Guarded by the presenter's disabled Save button too (incomplete
    // profile / invalid split), but re-checked here since this is the actual
    // write boundary.
    if (
      preview.kcal === null ||
      preview.macroGrams === null ||
      !macroSplitSumsTo100(preview.macroSplit)
    )
      return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const result = await setTargets(
        {
          dailyKcal: preview.kcal,
          proteinG: preview.macroGrams.proteinG,
          carbsG: preview.macroGrams.carbsG,
          fatG: preview.macroGrams.fatG,
          waterCups,
          preset: macroMode,
        },
        localDayISO(),
      );
      if (result === null) {
        setErrorMessage("Couldn't save your targets. Please try again.");
        return;
      }
      // PER-97 — remember the inputs behind these targets for the next open.
      if (userId) {
        await saveFuelCalculatorInputs(userId, {
          activityId,
          goal,
          calorieMode,
          manualKcalText,
          macroMode,
          customSplit,
        });
      }
      // Signal the Fuel screen (a pushed route underneath us) to re-read +
      // reconcile so the new target shows immediately on return, not on the
      // next cold start. Same mechanism the Scan/QuickAdd/Snap sheets and
      // recipe/meal logging already use.
      notifyFuelMutated();
      router.back();
    } finally {
      setIsSaving(false);
    }
  }, [
    preview,
    waterCups,
    macroMode,
    setTargets,
    notifyFuelMutated,
    router,
    userId,
    activityId,
    goal,
    calorieMode,
    manualKcalText,
    customSplit,
  ]);

  const isLoadingInitial =
    (profilePage.isRefreshing ||
      (profilePage.isStale && profilePage.error === null)) &&
    profilePage.payload === null;

  return (
    <FuelTargetsPresenter
      isLoadingInitial={isLoadingInitial}
      isSaving={isSaving}
      errorMessage={errorMessage}
      onCancel={onCancel}
      onSave={() => void onSave()}
      trainerName={target.data?.setByName ?? null}
      age={age}
      gender={gender}
      heightCm={heightCm}
      weightKg={weightKg}
      weightUnit={profile?.weightUnit ?? "kg"}
      heightUnit={quickProfile.profile?.heightUnit ?? "cm"}
      onOpenProfile={onboarding ? undefined : onOpenProfile}
      onEditProfileField={quickProfile.open}
      profileEditor={
        quickProfile.editor?.field === "weight" ? (
          <WeighInSheetContainer
            visible
            onClose={quickProfile.close}
            onSaved={body.reload}
          />
        ) : quickProfile.editor ? (
          <FuelProfileEditor
            state={quickProfile.editor}
            heightUnit={quickProfile.profile?.heightUnit ?? "cm"}
            weightUnit={profile?.weightUnit ?? "kg"}
            onChange={quickProfile.change}
            onHeightFormatChange={quickProfile.changeHeightFormat}
            onSave={quickProfile.save}
            onCancel={quickProfile.close}
          />
        ) : undefined
      }
      calorieMode={calorieMode}
      onCalorieModeChange={onCalorieModeChange}
      manualKcalText={manualKcalText}
      onManualKcalTextChange={onManualKcalTextChange}
      tdee={preview.tdee}
      kcal={preview.kcal}
      goalLabelInfo={preview.goalLabel}
      macroSplit={preview.macroSplit}
      macroGrams={preview.macroGrams}
      activityId={activityId}
      onActivityChange={onActivityChange}
      goal={goal}
      onGoalChange={onGoalChange}
      macroMode={macroMode}
      onMacroModeChange={onMacroModeChange}
      onProteinPctChange={onProteinPctChange}
      onCarbsPctChange={onCarbsPctChange}
      onFatPctChange={onFatPctChange}
      waterCups={waterCups}
      onWaterCupsChange={onWaterCupsChange}
      volumeUnit={volumeUnit}
      foodPreferencesSummary={foodPreferencesSummary}
      showFoodPreferences={mealprintGate.allowed && !onboarding}
      onOpenFoodPreferences={() => {
        if (onboarding) return;
        router.push("/(app)/fuel/preferences");
      }}
    />
  );
}

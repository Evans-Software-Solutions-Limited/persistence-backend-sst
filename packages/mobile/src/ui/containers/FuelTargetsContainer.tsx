/**
 * <FuelTargetsContainer> — wires the profile + nutrition-target hooks into
 * the pure <FuelTargetsPresenter> (M9 PR3, STORY-004).
 *
 * The calculator is a "compute fresh each time" tool, matching the design-
 * source prototype (`fuel-targets.jsx` has no concept of restoring a prior
 * session — it always starts from the profile + sensible defaults and lets
 * the sliders drive the live preview). `nutrition_targets` only persists the
 * RESULT (kcal/macros/water/preset), not the calculator inputs (activity
 * level, goal-slider position) — there's no column to hydrate them from.
 *
 * Deliberate scope line for AC 4.6 ("form pre-populates from current target
 * if exists"): only `waterCups` is hydrated from an existing target (a
 * trivial single-field carry-over with no interaction with the live-
 * calculator model). `macroMode`/the goal slider/activity level always start
 * at their defaults — re-deriving a percentage split + activity/goal
 * position from a saved kcal+grams target is possible but adds real
 * complexity (mode-validity checks, an effect racing the cache/fetch
 * lifecycle) for a cosmetic convenience the user resolves in a few taps.
 * Flagged here rather than silently built partially.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";

import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useGetNutritionTarget } from "@/ui/hooks/useGetNutritionTarget";
import { useGetBodyMeasurements } from "@/ui/hooks/useGetBodyMeasurements";
import { useSetTargets } from "@/ui/hooks/useSetTargets";
import { computeAge, localDayISO } from "@/shared/utils";
import {
  computeFuelTargetsPreview,
  DEFAULT_ACTIVITY_ID,
  macroSplitSumsTo100,
  presetSplit,
  recommendedSplit,
  type ActivityLevel,
  type MacroPresetMode,
  type MacroSplit,
} from "@/domain/services/nutrition.service";
import { FuelTargetsPresenter } from "@/ui/presenters/FuelTargetsPresenter";

const DEFAULT_WATER_CUPS = 8;
const DEFAULT_GOAL = 0;
const DEFAULT_MACRO_MODE: MacroPresetMode = "recommended";

export function FuelTargetsContainer() {
  const router = useRouter();
  const profilePage = useProfilePage();
  const target = useGetNutritionTarget();
  const body = useGetBodyMeasurements(30);
  const { mutate: setTargets } = useSetTargets();

  const [activityId, setActivityId] =
    useState<ActivityLevel["id"]>(DEFAULT_ACTIVITY_ID);
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [macroMode, setMacroMode] =
    useState<MacroPresetMode>(DEFAULT_MACRO_MODE);
  const [customSplit, setCustomSplit] = useState<MacroSplit>(
    recommendedSplit(DEFAULT_GOAL),
  );
  const [waterCups, setWaterCups] = useState(DEFAULT_WATER_CUPS);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
  const age = computeAge(profile?.dateOfBirth ?? null);
  const gender = profile?.gender ?? null;
  const heightCm = profile?.heightCm ?? null;
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
  const weightKg = latestWeightKg ?? profile?.weightKg ?? null;

  const preview = useMemo(
    () =>
      computeFuelTargetsPreview(
        { sex: gender, age, heightCm, weightKg },
        activityId,
        goal,
        macroMode,
        customSplit,
      ),
    [gender, age, heightCm, weightKg, activityId, goal, macroMode, customSplit],
  );

  // Switching INTO Custom mode snapshots whatever split was effectively
  // showing (the just-left preset's fixed values) so the sliders start where
  // the user left off rather than some stale prior customSplit. Switching
  // between two fixed presets (or back out of Custom) needs no snapshot —
  // each fixed preset's split is a pure constant lookup.
  const onMacroModeChange = useCallback(
    (nextMode: MacroPresetMode) => {
      if (nextMode === "custom" && macroMode !== "custom") {
        setCustomSplit(presetSplit(macroMode, goal));
      }
      setMacroMode(nextMode);
    },
    [macroMode, goal],
  );

  const onProteinPctChange = useCallback(
    (pct: number) => setCustomSplit((prev) => ({ ...prev, proteinPct: pct })),
    [],
  );
  const onCarbsPctChange = useCallback(
    (pct: number) => setCustomSplit((prev) => ({ ...prev, carbsPct: pct })),
    [],
  );
  const onFatPctChange = useCallback(
    (pct: number) => setCustomSplit((prev) => ({ ...prev, fatPct: pct })),
    [],
  );

  const onCancel = useCallback(() => {
    router.back();
  }, [router]);

  const onOpenProfile = useCallback(() => {
    router.push("/(app)/profile/edit");
  }, [router]);

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
      router.back();
    } finally {
      setIsSaving(false);
    }
  }, [preview, waterCups, macroMode, setTargets, router]);

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
      onOpenProfile={onOpenProfile}
      tdee={preview.tdee}
      kcal={preview.kcal}
      goalLabelInfo={preview.goalLabel}
      macroSplit={preview.macroSplit}
      macroGrams={preview.macroGrams}
      activityId={activityId}
      onActivityChange={setActivityId}
      goal={goal}
      onGoalChange={setGoal}
      macroMode={macroMode}
      onMacroModeChange={onMacroModeChange}
      onProteinPctChange={onProteinPctChange}
      onCarbsPctChange={onCarbsPctChange}
      onFatPctChange={onFatPctChange}
      waterCups={waterCups}
      onWaterCupsChange={onWaterCupsChange}
    />
  );
}

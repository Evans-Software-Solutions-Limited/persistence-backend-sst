import { useCallback, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  DEFAULT_MEALPRINT_PREFERENCES,
  isAllergenKey,
  isDietaryPattern,
  isEffortLevel,
  MAX_FREE_TEXT_ITEMS,
  MAX_FREE_TEXT_LENGTH,
  MAX_MEALS_PER_DAY,
  MIN_MEALS_PER_DAY,
  type AllergenKey,
  type DietaryPattern,
  type EffortLevel,
  type SetMealprintPreferencesInput,
} from "@/domain/models/mealprint";
import { useMealprintPreferences } from "@/ui/hooks/useMealprintPreferences";
import { useSetMealprintPreferences } from "@/ui/hooks/useSetMealprintPreferences";
import { useFuelSheets } from "@/state/fuel-sheets";
import {
  MealprintPreferencesPresenter,
  type MealprintPreferencesMode,
} from "@/ui/presenters/mealprint/MealprintPreferencesPresenter";

/**
 * <MealprintPreferencesContainer> — owns the draft state for the Mealprint food
 * preferences form (spec-26 T-0.6, STORY-001).
 *
 * Serves both entry points off one `mode`:
 *
 *  - `wizard` — pushed from the Fuel Mealprint card on first run. "Skip" SAVES
 *    the defaults rather than just navigating back (AC 1.4): skipping is a real
 *    choice, and persisting it is what stops the wizard reappearing on every
 *    launch. Without that, `isDefault` stays true forever and the card keeps
 *    offering a first run to someone who has already declined one.
 *  - `editor` — pushed from Fuel Targets. "Cancel" discards.
 *
 * ## ⚠ Draft seeding, and why it is latched TWICE
 *
 * The form is seeded ONCE from whichever preferences arrive first — the
 * synchronous SQLite read on mount, or the network refresh moments later. A naive
 * `useEffect` on `data` would re-seed on the refresh and **silently discard
 * whatever the user had already changed** in the second or two the fetch takes,
 * which on this screen means losing an allergen selection.
 *
 * Latching on "have I seeded yet" is NOT sufficient on its own, and this is the
 * subtle half. On a fresh install the cache is empty, so `data` is null on mount
 * and the seed effect bails **without arming** — leaving a window between mount
 * and the fetch landing in which the user can already be tapping chips. The seed
 * then fires for the first time and overwrites them. That window is short but it
 * is exactly the one a first-run user is in.
 *
 * So there are two guards: `seededRef` (seed at most once) and `touchedRef` (never
 * seed over a form the user has already changed). Both are refs — arming them must
 * not re-render, and `touchedRef` in particular has to be set synchronously inside
 * the handler so it is already true by the time the fetch's effect runs.
 *
 * ## ⚠ Client-side caps mirror the server's
 *
 * `MAX_FREE_TEXT_ITEMS` / `MAX_FREE_TEXT_LENGTH` and the 2–6 meals bound are
 * enforced here as well as by the handler and the DB CHECK. That is not
 * belt-and-braces for its own sake: the write is QUEUED, so a rejected PUT
 * surfaces through the sync-failure screen minutes later rather than inline, and
 * the only good place to refuse an over-long dislike is the keystroke that makes
 * it one.
 */

export type MealprintPreferencesContainerProps = {
  readonly mode?: MealprintPreferencesMode;
};

/** Trim and collapse whitespace. The server normalises further (accents,
 * lowercasing) — this only has to make the local dedupe honest. */
function tidy(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function MealprintPreferencesContainer({
  mode = "editor",
}: MealprintPreferencesContainerProps) {
  const preferences = useMealprintPreferences(true);
  const setPreferences = useSetMealprintPreferences();
  const notifyFuelMutated = useFuelSheets((s) => s.notifyMutated);

  const [dietaryPatterns, setDietaryPatterns] = useState<DietaryPattern[]>([]);
  const [avoidAllergens, setAvoidAllergens] = useState<AllergenKey[]>([]);
  const [avoidFoods, setAvoidFoods] = useState<string[]>([]);
  const [likedFoods, setLikedFoods] = useState<string[]>([]);
  const [mealsPerDay, setMealsPerDay] = useState<number>(
    DEFAULT_MEALPRINT_PREFERENCES.mealsPerDay,
  );
  const [effortLevel, setEffortLevel] = useState<EffortLevel>(
    DEFAULT_MEALPRINT_PREFERENCES.effortLevel,
  );
  const [avoidFoodDraft, setAvoidFoodDraft] = useState("");
  const [likedFoodDraft, setLikedFoodDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // See the docstring for why BOTH latches are needed.
  const seededRef = useRef(false);
  /** Set by every change handler, synchronously, before its `setState`. */
  const touchedRef = useRef(false);
  const data = preferences.data;
  useEffect(() => {
    if (seededRef.current || touchedRef.current || data === null) return;
    seededRef.current = true;
    // The wire arrays are `string[]` (the server validates against the closed
    // vocabularies but the DTO does not narrow). Filter through the local
    // vocabularies rather than casting, so a value this build does not know about
    // is dropped from the FORM instead of being rendered as a dead chip and then
    // echoed back on save.
    setDietaryPatterns(data.dietaryPatterns.filter(isDietaryPattern));
    setAvoidAllergens(data.avoidAllergens.filter(isAllergenKey));
    setAvoidFoods([...data.avoidFoods]);
    setLikedFoods([...data.likedFoods]);
    setMealsPerDay(
      Math.min(
        MAX_MEALS_PER_DAY,
        Math.max(MIN_MEALS_PER_DAY, data.mealsPerDay),
      ),
    );
    // Same reasoning as the arrays above — the DTO types this as `EffortLevel`,
    // but it is a plain string on the wire and it drives a `Segmented` whose
    // value must match one of its options or nothing renders as selected.
    if (isEffortLevel(data.effortLevel)) setEffortLevel(data.effortLevel);
  }, [data]);

  /**
   * Mark the form dirty. Called at the TOP of every change handler, before its
   * `setState`, so the seed effect can never run over a form the user has already
   * touched — including in the window before the first fetch lands. See the
   * docstring.
   */
  const markTouched = useCallback(() => {
    touchedRef.current = true;
  }, []);

  const onTogglePattern = useCallback(
    (pattern: DietaryPattern) => {
      markTouched();
      void Haptics.selectionAsync();
      setDietaryPatterns((prev) =>
        prev.includes(pattern)
          ? prev.filter((value) => value !== pattern)
          : [...prev, pattern],
      );
    },
    [markTouched],
  );

  const onToggleAllergen = useCallback(
    (allergen: AllergenKey) => {
      markTouched();
      void Haptics.selectionAsync();
      setAvoidAllergens((prev) =>
        prev.includes(allergen)
          ? prev.filter((value) => value !== allergen)
          : [...prev, allergen],
      );
    },
    [markTouched],
  );

  const onAddAvoidFood = useCallback(() => {
    const value = tidy(avoidFoodDraft);
    if (value === "" || value.length > MAX_FREE_TEXT_LENGTH) return;
    markTouched();
    setAvoidFoods((prev) => {
      if (prev.length >= MAX_FREE_TEXT_ITEMS) return prev;
      // Case-insensitive dedupe: the server normalises on write, so "Olives" and
      // "olives" become the same stored row and adding both would show one chip
      // vanishing on the next read.
      if (prev.some((item) => item.toLowerCase() === value.toLowerCase()))
        return prev;
      return [...prev, value];
    });
    setAvoidFoodDraft("");
  }, [avoidFoodDraft, markTouched]);

  const onAddLikedFood = useCallback(() => {
    const value = tidy(likedFoodDraft);
    if (value === "" || value.length > MAX_FREE_TEXT_LENGTH) return;
    markTouched();
    setLikedFoods((prev) => {
      if (prev.length >= MAX_FREE_TEXT_ITEMS) return prev;
      if (prev.some((item) => item.toLowerCase() === value.toLowerCase()))
        return prev;
      return [...prev, value];
    });
    setLikedFoodDraft("");
  }, [likedFoodDraft, markTouched]);

  const onRemoveAvoidFood = useCallback(
    (value: string) => {
      markTouched();
      setAvoidFoods((prev) => prev.filter((item) => item !== value));
    },
    [markTouched],
  );

  const onRemoveLikedFood = useCallback(
    (value: string) => {
      markTouched();
      setLikedFoods((prev) => prev.filter((item) => item !== value));
    },
    [markTouched],
  );

  const onMealsPerDayChange = useCallback(
    (value: number) => {
      markTouched();
      void Haptics.selectionAsync();
      setMealsPerDay(
        Math.min(MAX_MEALS_PER_DAY, Math.max(MIN_MEALS_PER_DAY, value)),
      );
    },
    [markTouched],
  );

  const onEffortLevelChange = useCallback(
    (value: EffortLevel) => {
      markTouched();
      void Haptics.selectionAsync();
      setEffortLevel(value);
    },
    [markTouched],
  );

  const savingRef = useRef(false);
  const commit = useCallback(
    async (input: SetMealprintPreferencesInput) => {
      // Ref-guarded so a double-tap on Save cannot enqueue two full-replacement
      // writes. State alone leaves a window where both taps pass the check.
      if (savingRef.current) return;
      savingRef.current = true;
      setIsSaving(true);
      setErrorMessage(null);
      try {
        const saved = await setPreferences.mutate(input);
        if (saved === null) {
          // No session — the only way `mutate` answers null. Nothing was written,
          // so say so rather than navigating away as if it had been.
          setErrorMessage("You need to be signed in to save preferences.");
          return;
        }
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        // Fuel's entry card reads the same cache; nudge it to re-read so a
        // first-run save stops offering the wizard immediately.
        notifyFuelMutated();
        router.back();
      } finally {
        savingRef.current = false;
        setIsSaving(false);
      }
    },
    [setPreferences, notifyFuelMutated],
  );

  const onSave = useCallback(() => {
    void commit({
      dietaryPatterns,
      avoidAllergens,
      avoidFoods,
      likedFoods,
      mealsPerDay,
      effortLevel,
      locale: DEFAULT_MEALPRINT_PREFERENCES.locale,
    });
  }, [
    commit,
    dietaryPatterns,
    avoidAllergens,
    avoidFoods,
    likedFoods,
    mealsPerDay,
    effortLevel,
  ]);

  const onDismiss = useCallback(() => {
    if (mode === "editor") {
      router.back();
      return;
    }
    // Wizard skip = save the defaults (AC 1.4). See the docstring for why this is
    // a write rather than a plain `router.back()`.
    void commit(DEFAULT_MEALPRINT_PREFERENCES);
  }, [mode, commit]);

  return (
    <MealprintPreferencesPresenter
      mode={mode}
      // Only a genuinely empty cache blocks the form. Once anything has been read
      // the user can edit while the refresh lands behind them — the seed latch is
      // what makes that safe.
      isLoadingInitial={data === null && preferences.error === null}
      isSaving={isSaving}
      errorMessage={
        errorMessage ??
        (data === null && preferences.error !== null
          ? "Couldn't load your preferences. Check your connection."
          : null)
      }
      dietaryPatterns={dietaryPatterns}
      onTogglePattern={onTogglePattern}
      avoidAllergens={avoidAllergens}
      onToggleAllergen={onToggleAllergen}
      avoidFoods={avoidFoods}
      avoidFoodDraft={avoidFoodDraft}
      onAvoidFoodDraftChange={setAvoidFoodDraft}
      onAddAvoidFood={onAddAvoidFood}
      onRemoveAvoidFood={onRemoveAvoidFood}
      likedFoods={likedFoods}
      likedFoodDraft={likedFoodDraft}
      onLikedFoodDraftChange={setLikedFoodDraft}
      onAddLikedFood={onAddLikedFood}
      onRemoveLikedFood={onRemoveLikedFood}
      mealsPerDay={mealsPerDay}
      onMealsPerDayChange={onMealsPerDayChange}
      effortLevel={effortLevel}
      onEffortLevelChange={onEffortLevelChange}
      onSave={onSave}
      onDismiss={onDismiss}
    />
  );
}

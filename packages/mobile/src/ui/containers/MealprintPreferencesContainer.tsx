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
 * ## ⚠ Draft seeding — `touchedRef` ALONE, and five wipe routes taught us why
 *
 * `data` arrives twice: the synchronous SQLite read on mount, then the network
 * refresh. The form re-seeds from whichever is newest **while the user has not
 * touched it**, and bails the moment they have.
 *
 * `touchedRef` is set synchronously at the top of every change handler, before its
 * `setState`, so it is already true by the time the fetch's effect runs — including
 * in the window between mount and the fetch landing, which on a fresh install is
 * exactly where a first-run user is.
 *
 * ⚠ **There used to be a second latch (`seededRef`) bailing this effect, and it was
 * itself a wipe route.** It pinned the form to the CACHE for life, so a device whose
 * cached row was older than the server's displayed stale values — and `PUT` being a
 * full last-write-wins replacement, Save then destroyed the newer row. `seededRef`
 * survives for `isUnseeded` only.
 *
 * ## ⚠ FIVE routes into the same allergen wipe. Read before touching `onDismiss`.
 *
 * `PUT /nutrition/preferences` is a full replacement and this form renders empty
 * defaults until seeded, so **every exit is a candidate wipe until proven
 * otherwise.** The guards, each closing a route the others did not:
 *
 * | Guard | Route it closes |
 * | --- | --- |
 * | `isUnseeded` | failed read, empty cache — Save/Skip wrote four empty arrays |
 * | `commit()`'s own refusal | the same, defended independently of the UI |
 * | `hasSavedChoices` | SUCCESSFUL read over real preferences — a reinstall opens the wizard and Skip wrote defaults |
 * | `serverTruthKnown` | cache says `isDefault: true`, server disagrees — Skip inside the fetch window |
 * | no `seededRef` bail | stale cache never re-seeded — Save wrote the old row over the new one |
 *
 * The pattern in all five: **a cached value was treated as server truth.** If you add
 * a sixth exit from this screen, assume it wipes until you have shown it cannot.
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

  /**
   * Set on the first seed. ⚠ Read by {@link isUnseeded} ONLY — it deliberately no
   * longer bails the seed effect. See the effect's own note.
   */
  const seededRef = useRef(false);
  /** Set by every change handler, synchronously, before its `setState`. */
  const touchedRef = useRef(false);
  const data = preferences.data;
  useEffect(() => {
    // ⚠ `touchedRef` ALONE, deliberately — `seededRef` used to bail here too and
    // that was the FIFTH route into the allergen wipe (Inspector Brad, 4th sweep).
    //
    // `data` arrives from SQLite synchronously on mount and from the network a
    // moment later. Latching on "have I seeded once" pinned the form to the CACHE
    // for the rest of its life, so a device whose cached row was older than the
    // server's showed the user stale values — and because `PUT` is a full
    // last-write-wins replacement, **Save then destroyed the newer row**. That
    // needed no race at all: the form simply displayed the wrong data and the
    // primary button wrote it.
    //
    // Re-seeding while `touchedRef` is false is safe and correct — an untouched
    // form has nothing to protect, and the fresher value is the one the user
    // should be editing. `touchedRef` alone still gives the guarantee the
    // docstring wants (never seed over the user's own edits), including in the
    // empty-cache window, because it is set synchronously inside every handler.
    //
    // Safe against a render loop: `data` is `useState`-held in
    // `useCachedResource`, so its identity changes only when `setData` runs.
    if (touchedRef.current || data === null) return;
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

  /**
   * ⚠ **The form has never been seeded, so nothing here may be written.**
   *
   * `PUT /nutrition/preferences` is a full LAST-WRITE-WINS replacement, and the
   * form renders with {@link DEFAULT_MEALPRINT_PREFERENCES} in state until the
   * seed effect runs. On a device whose cache is empty (a reinstall, a new device,
   * a sign-out/in) a FAILED `GET` leaves `data === null` forever — and because
   * `isLoadingInitial` only covers the still-loading case, the loader clears and
   * the whole form becomes live with empty arrays in it.
   *
   * From there, Save — or the wizard's Skip, which is a real write (AC 1.4) —
   * queues a replacement that DELETES the user's saved allergen list, dietary
   * pattern and both free-text lists, server-side, with nothing on screen to say
   * so. The path is not exotic: `useMealprintEntry` treats an empty cache as
   * `needsSetup` and pushes `?mode=wizard`, so the first thing a reinstalled
   * device does is open a form whose Skip button can wipe the row it failed to
   * read.
   *
   * The seed latch protects a TOUCHED form from a late fetch. This protects the
   * SERVER ROW from an unseeded form. They are different guards and the slice
   * needed both.
   */
  const isUnseeded = !seededRef.current && data === null;

  const savingRef = useRef(false);
  const commit = useCallback(
    async (input: SetMealprintPreferencesInput) => {
      // See `isUnseeded`. Refusing costs the user a retry; writing costs them
      // their allergen list.
      if (!seededRef.current && data === null) {
        setErrorMessage(
          "We couldn't load your preferences, so there's nothing to save yet. Check your connection and reopen this screen.",
        );
        return;
      }
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
    [data, setPreferences, notifyFuelMutated],
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

  /**
   * ⚠ TRUE when the server row this form was seeded from holds REAL choices.
   *
   * The wizard's dismiss is a WRITE of the defaults (AC 1.4) — that write is what
   * records "I have been asked and declined", so the card stops offering the wizard.
   * But it is only a safe write when there is nothing to lose, and the THIRD route
   * into an allergen-wipe runs straight through it:
   *
   *   `useMealprintEntry` reads preferences CACHE-ONLY (deliberately — an eager
   *   fetch on the Fuel tab was part of the launch fan-out), so on a reinstall,
   *   a new device, or after a sign-out/in, `data === null` and the card reports
   *   `needsSetup`. It therefore opens the WIZARD. This container then fetches for
   *   itself, succeeds, and seeds the form with the user's real allergen list — so
   *   `isUnseeded` is false and the old code fell through to
   *   `commit(DEFAULT_MEALPRINT_PREFERENCES)`. One tap on Skip, allergens gone.
   *
   * `isUnseeded` cannot catch this: the fetch SUCCEEDED. The earlier 🔴 was about a
   * FAILED read; this is the same wipe via a successful one. So the guard here is
   * not "did we read the row" but "does the row contain anything worth keeping".
   */
  const hasSavedChoices = data !== null && data.isDefault !== true;

  /**
   * ⚠ TRUE once a NETWORK read has landed — i.e. `data` is server truth, not just
   * whatever SQLite happened to hold.
   *
   * `useCachedResource`'s cache read always declares `isStale: true` and only
   * `attemptFetch` clears it (`setIsStale(false)` on success), so this is exactly
   * "have we heard from the server". ⚠ Do NOT substitute `isRefreshing` — the first
   * attempt at this guard used it and it is unobservable: the true→false transition
   * can batch into one commit, so the effect never sees `true` and the flag never
   * arms. That silently blocked the AC 1.4 first-run write instead.
   *
   * Why it is needed: {@link hasSavedChoices} is computed from `data`, which on
   * mount is the SYNCHRONOUS SQLite value. That made it the FOURTH route into the
   * allergen wipe (Inspector Brad, 4th sweep) — a device holding a cached
   * `isDefault: true` row, whose user then set allergens elsewhere, opens the wizard
   * with the form already live (cache hit ⇒ `isLoadingInitial` false),
   * `hasSavedChoices` false, header reading "Skip". A tap inside that window wrote
   * the defaults over the real row.
   *
   * A failed refresh deliberately never arms this, so the wizard does not write.
   * That costs one extra wizard appearance; writing costs the allergen list.
   */
  const serverTruthKnown = !preferences.isStale;

  const onDismiss = useCallback(() => {
    // ⚠ An unseeded form leaves WITHOUT writing, in either mode. This is the Back
    // action on the load-failure panel, and turning it into a save-the-defaults
    // write there is precisely the allergen-wipe `isUnseeded` exists to prevent.
    // (`commit` would refuse anyway, but it would refuse by setting an error the
    // panel does not render — so the button would silently do nothing.)
    //
    // ⚠ `hasSavedChoices` is the third case, and it leaves WITHOUT writing too.
    // Skipping means "don't make me configure this now" — never "erase what I
    // already told you". Not writing is safe: real choices mean `isDefault` is
    // false, so `needsSetup` is already false and the card will not re-offer the
    // wizard once this screen's fetch has warmed the cache.
    // ⚠ `!serverTruthKnown` is the fourth guard, and it must stay ahead of the
    // write: an unsettled read means we do not YET know whether there is anything
    // to preserve, and the cache can say "nothing" while the server says
    // "peanuts". See `serverTruthKnown`.
    if (
      mode === "editor" ||
      isUnseeded ||
      hasSavedChoices ||
      !serverTruthKnown
    ) {
      router.back();
      return;
    }
    // Genuine first run — nothing saved, so save the defaults (AC 1.4). See the
    // docstring for why this is a write rather than a plain `router.back()`.
    void commit(DEFAULT_MEALPRINT_PREFERENCES);
  }, [mode, isUnseeded, hasSavedChoices, serverTruthKnown, commit]);

  const onRetryLoad = useCallback(() => {
    void preferences.refresh();
  }, [preferences]);

  return (
    <MealprintPreferencesPresenter
      mode={mode}
      // Only a genuinely empty cache blocks the form. Once anything has been read
      // the user can edit while the refresh lands behind them — the seed latch is
      // what makes that safe.
      isLoadingInitial={data === null && preferences.error === null}
      isSaving={isSaving}
      errorMessage={errorMessage}
      // ⚠ `isUnseeded`, not `preferences.error !== null`. A refresh that fails
      // AFTER the form was seeded is harmless — the user is editing real values and
      // the write is queued — so it must not tear the form down under them. What is
      // NOT safe is a form that never saw the server row. See `isUnseeded`.
      loadFailed={isUnseeded && preferences.error !== null}
      // ⚠ The label has to follow the BEHAVIOUR, not the mode. When there are saved
      // choices the wizard's dismiss no longer writes the defaults, so calling it
      // "Skip" would describe an action it no longer performs — and "skip setup" is
      // exactly what makes a user expect their existing answers to be discarded.
      // See `hasSavedChoices`.
      // ⚠ Follows the BEHAVIOUR, including the uncertainty: while server truth is
      // unknown `onDismiss` does not write, so it must not say "Skip".
      dismissLabel={
        mode === "editor" || hasSavedChoices || !serverTruthKnown
          ? "Cancel"
          : "Skip"
      }
      onRetryLoad={onRetryLoad}
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

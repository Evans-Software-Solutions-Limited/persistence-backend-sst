import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { localDayISO, loggedAtNoonUtc } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useLogEntry } from "@/ui/hooks/useLogEntry";
import { useMealSuggest } from "@/ui/hooks/useMealSuggest";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";
import { useMealprintPreferences } from "@/ui/hooks/useMealprintPreferences";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  draftFromSuggestion,
  sumKeptDraftKcal,
  type MealprintDraft,
  type MealSuggestion,
  type SuggestShape,
} from "@/domain/models/mealprint";
import type { MealSlot } from "@/domain/models/nutrition";
import {
  MealprintSuggestSheetPresenter,
  type MealprintSuggestStage,
} from "@/ui/presenters/mealprint/MealprintSuggestSheetPresenter";

/**
 * <MealprintSuggestSheetContainer> — root-mounted fill-my-macros sheet
 * (spec-26 T-1.5, STORY-003).
 *
 * Owns the shape/steer inputs, the suggest call, the draft-review state and the
 * log. The remaining kcal/macros are NOT read here: the endpoint computes them
 * server-side from `date` + the day's entries + the active target, which is what
 * makes the tolerance check and the candidate pool agree with each other. This
 * container only supplies the device's local day.
 *
 * ## ⚠ Nothing fires on mount
 *
 * Root-mounted means always mounted (that is what keeps z-order and the slide-out
 * exit animation working), and **closing a sheet is not an unmount**. So every
 * data path here is gated on `visible`:
 *
 *  - `useMealprintPreferences(visible)` fetches on the first real open, not on
 *    cold launch. Seven sheets calling their hooks unconditionally is what
 *    produced ~28 requests inside 100 ms against a 10-concurrency Lambda quota,
 *    with roughly 16 coming back 503.
 *  - `useMealSuggest` is imperative and only runs from the Generate button.
 *
 * ## ⚠ Why the gate is re-checked here
 *
 * `useMealprintEntry` already gates the Fuel card, so an unentitled user should
 * never reach this sheet. This container defends anyway — connectivity and
 * subscription state can change while a sheet is open, and a 402 arriving in a
 * sheet with no upgrade affordance is a dead end. Cheap: the gate reads the same
 * two cached queries the entry card does.
 *
 * ## ⚠ Draft state lives here, not in a zustand slice
 *
 * The design sketches a store for draft-review state, and that is right for the
 * PLAN flow (a multi-meal draft surviving swap/edit/remove across a pushed
 * screen). A suggestion draft is one selection inside one sheet with a single
 * exit, so a store would add a lifetime that has to be reset on open, on close,
 * on log and on error — four chances to leak a stale draft into the next open, for
 * no cross-surface benefit.
 */

/** Module-level so the "no result yet" case is referentially stable. */
const EMPTY_SUGGESTIONS: readonly MealSuggestion[] = [];

export function MealprintSuggestSheetContainer() {
  const sheet = useFuelSheets((s) => s.sheet);
  const close = useFuelSheets((s) => s.close);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const activeDate = useFuelSheets((s) => s.date);
  const slotFromStore = useFuelSheets((s) => s.slot);
  const visible = sheet === "mealprintSuggest";

  const online = useOnlineStatus();
  const gate = useMealprintGate();
  // Gated on `visible` — see the docstring. Read for the dietary patterns, which
  // drive the halal/kosher enforcement caveat.
  const preferences = useMealprintPreferences(visible);
  const suggest = useMealSuggest();
  const logEntry = useLogEntry();

  const [shape, setShape] = useState<SuggestShape>("either");
  const [steer, setSteer] = useState("");
  const [draft, setDraft] = useState<MealprintDraft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [added, setAdded] = useState(false);
  // ⚠ A confirm that throws PART-WAY leaves items logged. Distinct from
  // `suggest.failure` (which is the generate call) because it is NOT retryable
  // here — re-running the log would double-count whatever already landed.
  const [confirmError, setConfirmError] = useState(false);

  // Guard convention shared with Scan/Quick-add/Snap: only a genuine dismiss of
  // THIS sheet (still visible) clears the store — a controlled handoff to another
  // root sheet must be a no-op (see fuel-sheets.ts § FuelSheet).
  const onSheetClose = useCallback(() => {
    if (visible) close();
  }, [visible, close]);

  /**
   * The post-confirm auto-dismiss timer.
   *
   * ⚠ Held so it can be CANCELLED, not only guarded. The guard inside the callback
   * stops it closing the wrong sheet; cancelling stops it existing at all once this
   * sheet has moved on. Root-mounted means unmount is rare, so the re-open cancel
   * is the one that matters in practice — and a live handle per confirm is what
   * makes jest report "did not exit one second after the test run".
   */
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearDismissTimer, [clearDismissTimer]);

  const { reset } = suggest;
  useEffect(() => {
    if (!visible) return;
    // Reset on OPEN rather than on close: the close animation is still running
    // when `visible` flips false, and blanking the body mid-slide-down is visible.
    clearDismissTimer();
    reset();
    setShape("either");
    setSteer("");
    setDraft(null);
    setConfirming(false);
    setAdded(false);
    setConfirmError(false);
  }, [visible, reset, clearDismissTimer]);

  const { run, retry } = suggest;
  const onGenerate = useCallback(() => {
    // Offline and the paywall both take precedence over the request. The card
    // that opens this sheet already checks both; these are the defence for state
    // that changed while the sheet was open.
    if (!online) return;
    // ⚠ UNRESOLVED IS NOT DENIED. `computeMealprintVerdict(null)` is `false` while
    // `/subscriptions/me` is still in flight — that is the safe default for
    // RENDERING (see the entry card's `pending` state), but as an ACTION guard it
    // sends an entitled Premium+ user to the paywall for a tap that landed inside
    // the first-fetch window. `useMealprintGate` exposes `isResolved` precisely so
    // consumers can tell the two apart, and this one was not reading it. Doing
    // nothing for that ~one frame is the correct failure direction; selling a user
    // a tier they already own is not.
    if (!gate.isResolved) return;
    if (!gate.allowed) {
      gate.onUpgrade();
      return;
    }
    setDraft(null);
    void run({
      shape,
      date: activeDate,
      steer: steer.trim() === "" ? undefined : steer.trim(),
    });
  }, [online, gate, run, shape, activeDate, steer]);

  const onRetry = useCallback(() => {
    if (!online) return;
    setDraft(null);
    void retry();
  }, [online, retry]);

  // Memoised so the `??` fallback does not mint a fresh empty array each render
  // and re-identify `onSelectSuggestion` (and through it the presenter) every time.
  const suggestions = useMemo(
    () => suggest.result?.suggestions ?? EMPTY_SUGGESTIONS,
    [suggest.result],
  );

  const onSelectSuggestion = useCallback(
    (index: number) => {
      const suggestion = suggestions[index];
      if (!suggestion) return;
      void Haptics.selectionAsync();
      // Seeded with the slot the day's flow was already targeting, so a user who
      // opened Fuel on a specific meal is not re-picking it.
      setDraft(draftFromSuggestion(suggestion, slotFromStore));
    },
    [suggestions, slotFromStore],
  );

  const onToggleDraftItem = useCallback((index: number) => {
    setDraft((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            items: prev.items.map((item, i) =>
              i === index ? { ...item, on: !item.on } : item,
            ),
          },
    );
  }, []);

  const onSlotChange = useCallback((slot: MealSlot) => {
    setDraft((prev) => (prev === null ? prev : { ...prev, slot }));
  }, []);

  const onBackToResults = useCallback(() => setDraft(null), []);

  const confirmingRef = useRef(false);
  const onConfirm = useCallback(async () => {
    // Ref, not state: a second tap during the same in-flight confirm is rejected
    // synchronously, so a double-tap cannot log the draft twice.
    if (confirmingRef.current || draft === null) return;
    const kept = draft.items.filter((item) => item.on);
    if (kept.length === 0) return;
    confirmingRef.current = true;
    setConfirming(true);
    try {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // The store's active day, not a date captured on the draft.
      // `<FuelContainer>` keeps it in sync with the day being viewed, so a
      // suggestion reviewed while looking at yesterday logs to yesterday — and
      // the day can legitimately change under an open sheet, so reading it here
      // rather than at draft-creation time is the correct freshness.
      const loggedAt = loggedAtNoonUtc(activeDate);
      for (const item of kept) {
        await logEntry.mutate({
          // ⚠ Log the REFERENCE, not a one-off. The server re-derives macros from
          // the row (per-serving × servings, identical to the basis the candidate
          // was assembled on), so the logged entry is server-authoritative, links
          // back to the real food/recipe/meal, and stays editable and deletable
          // like any other entry.
          ...(item.kind === "food"
            ? { foodId: item.candidateId }
            : item.kind === "recipe"
              ? { recipeId: item.candidateId }
              : { mealId: item.candidateId }),
          mealSlot: draft.slot,
          servings: item.servings,
          // ⚠ Sent even though the server ignores them on a referenced entry, and
          // that is the point: `logEntryCommand`'s OPTIMISTIC macro derivation
          // looks the row up in the local cache and falls back to these when it
          // misses. A curated Mealprint candidate is almost never in
          // `cached_foods` (the device only caches what it searched or scanned),
          // so without these the ring would show +0 kcal until the next refresh.
          kcal: item.kcal,
          proteinG: item.proteinG,
          carbsG: item.carbsG,
          fatG: item.fatG,
          // ⚠ Same reason. `entryDisplayLabel` resolves a referenced entry from
          // the local caches and now falls back to `customName` on a miss, so this
          // is what stops a Mealprint row reading "Logged food" in the meal log.
          customName: item.name,
          loggedAt,
        });
      }
      notifyMutated();
      setAdded(true);
      // Brief confirmation, then dismiss — matching the Snap sheet's cadence.
      //
      // ⚠ The timer must re-check WHICH sheet is open, not just call `close()`.
      // Users do not wait 900 ms: dismissing "Added ✓" by backdrop or swipe and
      // then opening Scan or Quick-add leaves this timer pending, and a bare
      // `close()` sets `sheet: null` unconditionally — snapping the newly-opened
      // sibling shut. This is the same reason `onSheetClose` guards on `visible`.
      // Read from the store rather than closing over `visible`, which is stale by
      // the time the timer fires.
      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = null;
        if (useFuelSheets.getState().sheet === "mealprintSuggest") close();
      }, 900);
    } catch {
      // ⚠ A throw here means items 1..k are ALREADY logged (the loop awaits one
      // mutation per item), so we must not leave the user on an unchanged draft:
      // they would re-confirm and double-log those k. Surface it and let them
      // dismiss — `notifyMutated` still fires so the ring reflects what landed.
      notifyMutated();
      setConfirmError(true);
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  }, [draft, activeDate, logEntry, notifyMutated, close]);

  // ⚠ `confirmError` outranks `added`: a part-way failure must never render the
  // success stage, whose 900 ms timer would then dismiss the sheet and hide it.
  const stage: MealprintSuggestStage = confirmError
    ? "error"
    : added
      ? "added"
      : draft !== null
        ? "draft"
        : suggest.stage === "generating"
          ? "generating"
          : suggest.stage === "error"
            ? "error"
            : suggest.stage === "ready"
              ? "results"
              : "setup";

  return (
    <MealprintSuggestSheetPresenter
      visible={visible}
      onClose={onSheetClose}
      stage={stage}
      offline={!online}
      shape={shape}
      onShapeChange={setShape}
      steer={steer}
      onSteerChange={setSteer}
      onGenerate={onGenerate}
      suggestions={suggestions}
      emptyReason={suggest.result?.emptyReason ?? null}
      remaining={suggest.result?.remaining ?? null}
      // ⚠ The sheet generates and LOGS against `activeDate`, so the copy must not
      // claim "today" on any other day. See the presenter's `isToday`.
      isToday={activeDate === localDayISO()}
      /**
       * ⚠ Two DIFFERENT cases, and collapsing them was a real hole.
       *
       * No result yet → `false`: nothing should claim a disclaimer the server has
       * not sent (and no pre-result stage renders one anyway).
       *
       * Result present but the FIELD absent → `true`. `suggestMeals` is an
       * unvalidated cast over the wire, so a deploy skew or a DTO refactor that
       * dropped `labelCheckRequired` would leave it `undefined` — and a blanket
       * `?? false` then renders real suggestions with NO allergen disclaimer,
       * which is exactly the failure the server's unconditional `true` and this
       * model's contract 1 exist to prevent. Failing safe costs a redundant
       * caveat; failing open costs the disclaimer on the surface that needs it.
       */
      labelCheckRequired={
        suggest.result === null
          ? false
          : (suggest.result.labelCheckRequired ?? true)
      }
      dietaryPatterns={preferences.data?.dietaryPatterns ?? []}
      /**
       * ⚠ The SERVER's verdict, not just the locally-cached patterns.
       *
       * The caveat used to be derived from `dietaryPatterns` alone — which meant a
       * halal user on a fresh install whose preferences fetch had not landed (or
       * had failed) got a result the server had flagged
       * `partialEnforcementOnly: true` with no caveat at all. The local patterns
       * still win when present, because they let the copy name exactly what is
       * enforced; this is the floor beneath them.
       */
      serverPartialEnforcementOnly={
        suggest.result?.partialEnforcementOnly ?? false
      }
      onSelectSuggestion={onSelectSuggestion}
      draft={draft}
      onToggleDraftItem={onToggleDraftItem}
      onSlotChange={onSlotChange}
      draftKcal={draft === null ? 0 : sumKeptDraftKcal(draft.items)}
      onConfirm={() => void onConfirm()}
      confirming={confirming}
      onBackToResults={onBackToResults}
      errorMessage={
        confirmError
          ? "Some items may not have been added. Close this and check your meal log before trying again."
          : (suggest.failure?.message ?? null)
      }
      // ⚠ Deliberately NOT retryable on a confirm failure: the loop logs one item
      // at a time, so a retry re-logs everything that already landed.
      errorRetryable={
        confirmError ? false : (suggest.failure?.retryable ?? false)
      }
      // A 402 here means the client verdict and the server disagreed (the entry
      // card gates on the same verdict, so this is rare) — the honest recovery is
      // the paywall, not a retry that will 402 again.
      errorIsEntitlement={
        confirmError ? false : (suggest.failure?.entitlementDenied ?? false)
      }
      onRetry={onRetry}
      onUpgrade={gate.onUpgrade}
    />
  );
}

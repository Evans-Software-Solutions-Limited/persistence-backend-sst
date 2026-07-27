import { create } from "zustand";
import type {
  EquipmentScanDraft,
  LoadoutPreview,
  SavedGym,
} from "@/domain/models/loadout";
import type { ManualPick } from "@/domain/services/loadout.service";

/**
 * useLoadoutFlow — the step machine behind Loadout's athlete flow (spec-21 § 10).
 *
 * Mirrors the `ProfileDrawer` / `useFuelSheets` pattern: the flow is mounted at
 * root `(app)/_layout` as a sibling of the Stack (so its sheets overlay the tab
 * bar — `memory/feedback_sheets_mount_at_root`) and reads `step` to drive itself.
 *
 * ## What this store is and is not
 *
 * It is UI-STATE ONLY: which step, which equipment context is being assembled,
 * which rows the user has hand-picked. It is deliberately NOT a cache of the
 * adaptation — `preview` holds the one in-flight preview so the review step can
 * render it without a refetch, and it is cleared on `reset()`. Nothing here is
 * persisted: an abandoned flow costs nothing to restart, and a half-collected
 * equipment context restored days later would be worse than a clean start. The
 * same reasoning as `useActiveWorkout` being UI-state rather than a set store.
 *
 * ## The step order, and why `adapting` is not a timer
 *
 *   detail → collect → (scan | manual | a saved gym) → adapting → review → saved
 *
 * The prototype auto-advances out of `adapting` after 1700 ms. **That must not
 * ship.** The real preview is a Bedrock call — E2 measured 2.6 s p50 / 3.8 s max
 * and `createWithRetry` can spend 24 s on the retry path — so the step is bound to
 * the request's resolution. A timer would either cut the request off visually while
 * it is still running or, worse, show a review screen with no data.
 *
 * ## Why the equipment context is a discriminated pair, not two loose fields
 *
 * `POST /workouts/:id/loadout/preview` takes EXACTLY ONE of `savedGymId` or
 * `equipmentTypeIds` — both, or neither, is a 400. Keeping the two in one
 * `context` union makes that structurally impossible to get wrong from here, which
 * is the single easiest mistake to make when a flow threads both through one state
 * object.
 */

export type LoadoutStep =
  | "collect"
  | "scan"
  | "manual"
  | "adapting"
  | "review"
  | "saved";

/**
 * The equipment context, as exactly one source.
 *
 * `gym` carries the name as well as the id purely for display — the request sends
 * only the id, and the server resolves the kit itself.
 */
export type LoadoutContext =
  | { readonly kind: "gym"; readonly gymId: string; readonly gymName: string }
  | {
      readonly kind: "ids";
      readonly equipmentTypeIds: readonly string[];
      /** What to call the setup: the typed name, or a default. */
      readonly label: string;
      /** True when the manual step's save toggle was on. */
      readonly saveAsGym: boolean;
    };

/** Which row the swap sheet is open for, if any. */
export type LoadoutSwapTarget = {
  readonly sortOrder: number;
  readonly exerciseId: string | null;
  readonly exerciseName: string;
};

export interface LoadoutFlowState {
  /** Null when the flow is closed. Opening always starts at `collect`. */
  step: LoadoutStep | null;
  /** The parent workout being adapted. */
  workoutId: string | null;
  workoutName: string;
  context: LoadoutContext | null;
  /** The in-flight adaptation. Null until `adapting` resolves. */
  preview: LoadoutPreview | null;
  /** The confirmed-draft state of a scan, before it becomes a context. */
  scanDraft: EquipmentScanDraft | null;
  /** Scan detections the user unticked (AC-2.3 — the draft is a draft). */
  scanDeselectedIds: ReadonlySet<string>;
  /** Hand-picked rows, keyed by `sortOrder`. See `ManualPick` for the flag rule. */
  manualPicks: ReadonlyMap<number, ManualPick>;
  swapTarget: LoadoutSwapTarget | null;
  /** The Premium+ upsell sheet. Opened when the entry point is tapped unentitled. */
  upsellOpen: boolean;
  /**
   * Monotonic counter bumped after a variation is saved, so the parent workout's
   * "Saved setups" list re-reads without the flow holding a reference to it.
   */
  rev: number;

  open: (workoutId: string, workoutName: string) => void;
  openUpsell: () => void;
  closeUpsell: () => void;
  goToStep: (step: LoadoutStep) => void;

  /**
   * ⚠ `selectGym` / `selectEquipmentIds`, NOT `useGym` / `useEquipmentIds`.
   * A store action whose name starts with `use` trips `react-hooks/rules-of-hooks`
   * at every call site inside a callback ("cannot be called inside a callback"),
   * and the workaround — aliasing to a non-`use` local — has to be rediscovered by
   * each new consumer. Renamed once at the source instead.
   */
  selectGym: (gym: Pick<SavedGym, "id" | "name">) => void;
  selectEquipmentIds: (
    equipmentTypeIds: readonly string[],
    label: string,
    saveAsGym: boolean,
  ) => void;

  setScanDraft: (draft: EquipmentScanDraft | null) => void;
  toggleScanDetection: (equipmentTypeId: string) => void;

  previewResolved: (preview: LoadoutPreview) => void;
  openSwap: (target: LoadoutSwapTarget) => void;
  closeSwap: () => void;
  applyManualPick: (sortOrder: number, pick: ManualPick) => void;
  clearManualPick: (sortOrder: number) => void;
  saved: () => void;
  reset: () => void;
}

const EMPTY_PICKS: ReadonlyMap<number, ManualPick> = new Map();
const EMPTY_DESELECTED: ReadonlySet<string> = new Set();

const CLOSED = {
  step: null,
  workoutId: null,
  workoutName: "",
  context: null,
  preview: null,
  scanDraft: null,
  scanDeselectedIds: EMPTY_DESELECTED,
  manualPicks: EMPTY_PICKS,
  swapTarget: null,
  upsellOpen: false,
} as const;

export const useLoadoutFlow = create<LoadoutFlowState>((set) => ({
  ...CLOSED,
  rev: 0,

  // Opening always resets everything except `rev`, so a second run of the flow can
  // never inherit the first's equipment context, preview or hand-picks. The bug
  // this prevents is quiet and bad: adapting workout B while still holding A's
  // manual picks would apply them by `sortOrder` to a different plan.
  open: (workoutId, workoutName) =>
    set({ ...CLOSED, step: "collect", workoutId, workoutName }),

  // The upsell is NOT a step: it is a sheet over whatever is behind it, and an
  // unentitled user has no flow to be in. Modelling it as a step would put the
  // paywall in the back-navigation history.
  openUpsell: () => set({ upsellOpen: true }),
  closeUpsell: () => set({ upsellOpen: false }),

  goToStep: (step) => set({ step }),

  // ⚠ Both of these clear the PREVIOUS adaptation, not just `context`. A user can
  // re-collect inside one run — review → back to collect → pick a different gym —
  // and `open()`'s reset does not fire on that path. Without clearing here, the old
  // `manualPicks` survive and `buildVariationExercises` applies them BY `sortOrder`
  // to the new plan: a pick that was compatible with kit A may not be with kit B,
  // and it carries `isUserOverride: false`, so the save 400s
  // `EQUIPMENT_NOT_AVAILABLE`. A stale `preview` is the same class of bug — a failed
  // second request would leave gym A's rows renderable on the review step.
  selectGym: (gym) =>
    set({
      context: { kind: "gym", gymId: gym.id, gymName: gym.name },
      step: "adapting",
      preview: null,
      manualPicks: EMPTY_PICKS,
      swapTarget: null,
    }),

  selectEquipmentIds: (equipmentTypeIds, label, saveAsGym) =>
    set({
      context: {
        kind: "ids",
        // Copied and de-duplicated: the caller's array is often a Set spread from
        // a picker, and a duplicate id would be sent to the server, which counts
        // `equipmentTypeIds.length` when it reports the context size back.
        equipmentTypeIds: Array.from(new Set(equipmentTypeIds)),
        label,
        saveAsGym,
      },
      step: "adapting",
      preview: null,
      manualPicks: EMPTY_PICKS,
      swapTarget: null,
    }),

  setScanDraft: (draft) =>
    // A fresh draft clears prior deselections: they were keyed to the previous
    // photo's detections and would silently untick items in the new one.
    set({ scanDraft: draft, scanDeselectedIds: EMPTY_DESELECTED }),

  toggleScanDetection: (equipmentTypeId) =>
    set((state) => {
      // ⚠ A server-INJECTED detection cannot be deselected. `Bodyweight` is
      // withheld from the model and injected precisely so the user is not offered
      // the chance to untick it (T-E1.7) — it is true of every room, and unticking
      // it would make every bodyweight exercise unavailable and get swapped or
      // dropped for no reason. Enforced here rather than only in the presenter, so
      // no future caller can route around it.
      const injected = state.scanDraft?.detected.some(
        (detection) =>
          detection.equipmentTypeId === equipmentTypeId &&
          detection.source === "injected",
      );
      if (injected) return {};

      const next = new Set(state.scanDeselectedIds);
      if (next.has(equipmentTypeId)) next.delete(equipmentTypeId);
      else next.add(equipmentTypeId);
      return { scanDeselectedIds: next };
    }),

  // Bound to the REQUEST, not a timer. See the docblock.
  previewResolved: (preview) => set({ preview, step: "review" }),

  openSwap: (target) => set({ swapTarget: target }),
  closeSwap: () => set({ swapTarget: null }),

  applyManualPick: (sortOrder, pick) =>
    set((state) => {
      const next = new Map(state.manualPicks);
      next.set(sortOrder, pick);
      // The sheet closes on selection — leaving it open over a row that has just
      // changed reads as though the pick did not take.
      return { manualPicks: next, swapTarget: null };
    }),

  clearManualPick: (sortOrder) =>
    set((state) => {
      if (!state.manualPicks.has(sortOrder)) return {};
      const next = new Map(state.manualPicks);
      next.delete(sortOrder);
      return { manualPicks: next };
    }),

  // `rev` bumps so the parent's "Saved setups" list re-reads. It survives `reset()`
  // — it is a signal to a DIFFERENT screen, and clearing it would drop the one
  // notification the list is waiting for.
  saved: () => set((state) => ({ step: "saved", rev: state.rev + 1 })),

  reset: () => set({ ...CLOSED }),
}));

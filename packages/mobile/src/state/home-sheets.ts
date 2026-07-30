import { create } from "zustand";

/**
 * useHomeSheets — open-state slice for Home's three quick-log sheets (Weigh in,
 * Water, Sleep). Mirrors the `useFuelSheets` / `useDrawer` pattern: the sheets
 * are ALWAYS mounted as siblings of the tab Stack in `(app)/_layout.tsx` and
 * read `sheet` to drive their own slide-in/out via the <BottomSheet> `visible`
 * prop.
 *
 * Why this store exists (it replaced three `useState`s in <HomeContainer>):
 * the sheets used to be mounted INSIDE HomeContainer's fragment, i.e. inside
 * the tab scene. Two consequences, both real:
 *
 *   1. They rendered ABOVE the in-flow tab bar instead of over it — the visible
 *      symptom, and the reason `feedback_sheets_mount_at_root` exists.
 *   2. gorhom measures its PARENT for `containerHeight`, so these three got the
 *      tab scene rather than the window — `tabBarHeight = 60 + insetBottom + 8`
 *      ≈ 102pt shorter. <BottomSheet> derives its body height from
 *      `useWindowDimensions()`, so the body overshot the real content box by
 *      ~90pt (`tall`) / ~61pt (`peek`) and that band was unreachable. On Weigh
 *      in it contained the Save button. Root-mounting makes the window the
 *      correct basis again (Inspector Brad 🟠, PR #336).
 *
 * `habitsRev` carries the one side effect that used to live in HomeContainer's
 * close handlers: logging water or sleep reflects into the habit-completion
 * cache synchronously, and Home's read-only habit grid must be re-pointed at
 * that cache on close so the tick shows without a pull-to-refresh. Now that
 * closing happens in a root-mounted container, HomeContainer can't observe it
 * directly — so `close()` bumps this counter and HomeContainer watches it. Same
 * monotonic-counter bridge `useHealthSync().revision` uses for the drawer.
 *
 * Deliberately bumped ONLY for water/sleep, matching the previous behaviour
 * exactly: closing the Weigh-in sheet never reloaded habits.
 *
 * Spec: feedback_sheets_mount_at_root
 *       specs/06-progress-goals/design.md § Home quick-log
 */

export type HomeSheet = "weighIn" | "water" | "sleep" | null;

export interface HomeSheetsState {
  sheet: HomeSheet;
  /**
   * Monotonic counter bumped when a sheet that reflects into the habit cache
   * (water or sleep) closes. <HomeContainer> reloads its habit grid on change.
   */
  habitsRev: number;
  openWeighIn: () => void;
  openWater: () => void;
  openSleep: () => void;
  close: () => void;
}

export const useHomeSheets = create<HomeSheetsState>((set) => ({
  sheet: null,
  habitsRev: 0,
  openWeighIn: () => set({ sheet: "weighIn" }),
  openWater: () => set({ sheet: "water" }),
  openSleep: () => set({ sheet: "sleep" }),
  close: () =>
    set((s) => ({
      sheet: null,
      habitsRev:
        s.sheet === "water" || s.sheet === "sleep"
          ? s.habitsRev + 1
          : s.habitsRev,
    })),
}));

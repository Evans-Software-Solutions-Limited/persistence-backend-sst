import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

/**
 * useActiveWorkout — UI-state machine for the minimise-to-bar pattern.
 *
 * Spec: specs/05-active-session/design.md § useActiveWorkout Zustand slice
 *         (Revised 2026-06-07 — Hybrid architecture)
 *       specs/05-active-session/requirements.md STORY-006 + STORY-007
 *
 * ── Hybrid scope (load-bearing — read before editing) ───────────────────────
 * This slice owns UI state ONLY: a lightweight pointer to the active workout
 * ({ sessionId, name, startedAt, … }) + the `expanded` flag (full screen vs
 * minimised bar). It deliberately does NOT hold set data.
 *
 *   1. No parallel set store. Set data lives in SQLite via `useActiveSession`
 *      (`getActiveSession(userId)` → active_sessions/session_exercises/
 *      exercise_sets). A second copy here would diverge from SQLite (the #1
 *      project invariant) and violate STORY-010. The pointer fields we DO keep
 *      (`name`, `startedAt`, `workoutId`) are immutable after session-start, so
 *      the small denormalised copy can't drift — unlike sets, which mutate
 *      every rep.
 *   2. Wall-clock elapsed, not a tick counter. Elapsed time is derived from
 *      `startedAt` (`activeWorkoutElapsedSeconds`) wherever it's displayed; the
 *      rendering component owns its own 1s re-render interval. A setInterval
 *      tick in the slice would freeze during backgrounding and undercount.
 *   3. AsyncStorage holds only the lightweight "a workout is active + its
 *      minimised pointer" flag — never a second copy of the set data. Session +
 *      set recovery on launch is SQLite's job (M3 recovery via getActiveSession);
 *      the orphan-pointer reconciliation (pointer present but SQLite empty)
 *      happens in the `app/_layout.tsx` wiring, which has adapter access. This
 *      slice stays adapter-free so it's unit-testable against a mocked
 *      AsyncStorage alone.
 *
 * The >24h stale + resume/discard prompt (STORY-007 AC 7.3) keys off the
 * pointer's `startedAt` (which mirrors the SQLite session's `startedAt`).
 */

const STORAGE_KEY = "persistence.activeWorkout";

/** Schema version of the persisted payload — bump to invalidate old shapes. */
const PERSIST_VERSION = 1;

/** Sessions older than this (by `startedAt`) prompt resume/discard on launch. */
export const STALE_THRESHOLD_HOURS = 24;

/**
 * Trainer-on-behalf context (M8 / `10-trainer-features`). Ephemeral UI state —
 * NOT persisted in SQLite, so the slice is its only home across a force-quit.
 * Defaults `undefined` until M8 wires the on-behalf session-creation flow; the
 * `<TrainerBannerPresenter>` renders only when this is present.
 */
export type ActiveWorkoutClientRef = {
  id: string;
  initials: string;
  name: string;
};

/**
 * Lightweight pointer to the in-flight session. Mirrors the immutable
 * identity fields of the SQLite `WorkoutSession` (`sessionId` ↔ `id`) plus the
 * ephemeral trainer context. The full session (incl. sets) is read separately
 * from SQLite via `useActiveSession`.
 */
export type ActiveWorkoutPointer = {
  /** SQLite session id — `local-…` until the bulk-record flush returns canonical. */
  sessionId: string;
  /** null for Quick Start sessions. */
  workoutId: string | null;
  /** Display name captured at session-start. */
  name: string;
  /** ISO timestamp — the single source for wall-clock elapsed + staleness. */
  startedAt: string;
  withClient?: ActiveWorkoutClientRef;
  retroactive?: boolean;
};

export type RehydrateResult =
  | { resumed: false }
  | { resumed: true; staleHours?: number };

export interface ActiveWorkoutState {
  /** The active workout pointer, or null when no session is in progress. */
  active: ActiveWorkoutPointer | null;
  /** true = full-screen session surface; false = minimised floating bar. */
  expanded: boolean;

  /** Begin a session — opens expanded. Called from the start-session flow. */
  start: (pointer: ActiveWorkoutPointer) => void;
  /**
   * Adopt an already-live session minimised, without opening it. Used by the
   * launch reconciliation when SQLite (the existence authority) holds an
   * in-progress session the slice doesn't yet know about — e.g. a session
   * begun by a pre-05 build, or one whose `start()` call didn't run this
   * launch. Distinct from `start` (which opens expanded for a user-initiated
   * begin).
   */
  adopt: (pointer: ActiveWorkoutPointer) => void;
  /** Collapse to the floating bar (chevron-down / route dismiss). */
  minimize: () => void;
  /** Re-open the full-screen surface (tap the bar). */
  expand: () => void;
  /** End/clear the session UI state + drop the persisted pointer. */
  end: () => Promise<void>;
  /**
   * Restore from AsyncStorage on launch. Handles four paths:
   *   - no key       → { resumed: false }
   *   - corrupt      → clears the key, { resumed: false }
   *   - valid fresh  → restores pointer minimised, { resumed: true }
   *   - valid stale  → restores pointer minimised, { resumed: true, staleHours }
   * Always restores in `expanded: false` (STORY-007 AC 7.2 — let the user
   * re-expand). The stale case still restores so the bar/prompt can render the
   * workout name + date; the wiring decides whether to keep or discard it.
   */
  rehydrate: () => Promise<RehydrateResult>;
}

type PersistedShape = {
  v: number;
  pointer: ActiveWorkoutPointer;
};

/**
 * Build a pointer from a SQLite `WorkoutSession`. The pointer mirrors the
 * session's immutable identity fields; trainer context (`withClient` /
 * `retroactive`) is not stored in SQLite, so it's carried only when the caller
 * supplies it (M8 on-behalf flow). Typed structurally to avoid importing the
 * full domain model into this presentation slice.
 */
export function pointerFromSession(
  session: {
    id: string;
    workoutId: string | null;
    name: string;
    startedAt: string;
    /**
     * Coach on-behalf client persisted on the SQLite session (M18). Recovered
     * here so a pointer reconstructed from SQLite on rehydrate carries the
     * coach context — without this, a force-quit → rehydrate would drop it and
     * the client's workout would be misattributed to the coach (Inspector Brad).
     */
    withClient?: ActiveWorkoutClientRef | null;
  },
  trainer?: { withClient?: ActiveWorkoutClientRef; retroactive?: boolean },
): ActiveWorkoutPointer {
  return {
    sessionId: session.id,
    workoutId: session.workoutId,
    name: session.name,
    startedAt: session.startedAt,
    // Explicit trainer arg (coach-start) wins; otherwise recover from the
    // session row (rehydrate/adopt path).
    withClient: trainer?.withClient ?? session.withClient ?? undefined,
    retroactive: trainer?.retroactive,
  };
}

/** Wall-clock elapsed seconds since `startedAt`. Never negative. */
export function activeWorkoutElapsedSeconds(
  startedAt: string,
  now: number = Date.now(),
): number {
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return 0;
  return Math.max(0, Math.floor((now - startedMs) / 1000));
}

/**
 * Best-effort persist of the lightweight pointer. Fire-and-forget with a
 * swallowed warning — mirrors `user-mode.ts`: the in-memory transition is the
 * user-visible effect and has already applied; a disk failure (full disk, RN
 * bridge tear-down on background) must not surface as an unhandled rejection.
 */
function persistPointer(pointer: ActiveWorkoutPointer): void {
  const payload: PersistedShape = { v: PERSIST_VERSION, pointer };
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch((err) => {
    console.warn("[active-workout] persist failed", err);
  });
}

/** Validate a parsed payload is a usable pointer (corrupt-detection). */
function isValidPointer(value: unknown): value is ActiveWorkoutPointer {
  if (value === null || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.sessionId === "string" &&
    p.sessionId.length > 0 &&
    typeof p.name === "string" &&
    typeof p.startedAt === "string" &&
    Number.isFinite(Date.parse(p.startedAt)) &&
    (p.workoutId === null || typeof p.workoutId === "string")
  );
}

export const useActiveWorkout = create<ActiveWorkoutState>((set) => ({
  active: null,
  expanded: false,

  start: (pointer) => {
    set({ active: pointer, expanded: true });
    persistPointer(pointer);
  },

  adopt: (pointer) => {
    set({ active: pointer, expanded: false });
    persistPointer(pointer);
  },

  minimize: () => {
    set({ expanded: false });
  },

  expand: () => {
    set({ expanded: true });
  },

  end: async () => {
    set({ active: null, expanded: false });
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.warn("[active-workout] end removeItem failed", err);
    }
  },

  rehydrate: async () => {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(STORAGE_KEY);
    } catch (err) {
      console.warn("[active-workout] rehydrate read failed", err);
      return { resumed: false };
    }
    if (!raw) return { resumed: false };

    let pointer: ActiveWorkoutPointer;
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedShape>;
      if (!isValidPointer(parsed?.pointer)) throw new Error("invalid shape");
      pointer = parsed.pointer;
    } catch {
      // Corrupt / legacy payload — drop it so we don't trip on it again.
      await AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
      return { resumed: false };
    }

    // Always restore minimised (STORY-007 AC 7.2). The bar/prompt renders from
    // the pointer; staleness only changes whether the wiring prompts.
    set({ active: pointer, expanded: false });

    const ageHours =
      (Date.now() - Date.parse(pointer.startedAt)) / (1000 * 60 * 60);
    if (ageHours > STALE_THRESHOLD_HOURS) {
      return { resumed: true, staleHours: ageHours };
    }
    return { resumed: true };
  },
}));

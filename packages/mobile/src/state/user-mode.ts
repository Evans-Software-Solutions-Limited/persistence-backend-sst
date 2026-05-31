import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

/**
 * useUserMode — runtime athlete/coach mode slice.
 *
 * Spec: specs/14-navigation/design.md § Mode-state slice
 *       specs/14-navigation/requirements.md STORY-003 (AC 3.1–3.5)
 *
 * The slice owns the persisted `mode` + the derived `isTrainerEligible`
 * flag. Eligibility is fed from `useGetUserSubscription().isTrainerTier`
 * by the wiring in `app/_layout.tsx` (Phase 14.2). The tab layout
 * (Phase 14.4) reads `mode` to swap the tab spec; `<TabBar>` reads it to
 * recolour the accent.
 */

const STORAGE_KEY = "persistence.userMode";
const VALID_MODES = ["athlete", "coach"] as const;
export type UserMode = (typeof VALID_MODES)[number];

function isUserMode(value: string | null): value is UserMode {
  return value !== null && (VALID_MODES as readonly string[]).includes(value);
}

export interface UserModeState {
  mode: UserMode;
  isTrainerEligible: boolean;
  /**
   * True once `setEligibility` has been called at least once — i.e. the
   * subscription cache has resolved. Gates the invariant watchdog so a
   * default-`false` `isTrainerEligible` (pre-network) can't be mistaken for
   * a confirmed-`false` (post-network) and demote a legitimate trainer.
   */
  isEligibilityKnown: boolean;
  switchTo: (next: UserMode) => Promise<void>;
  setEligibility: (eligible: boolean) => void;
  rehydrate: () => Promise<void>;
  /**
   * Return the slice to its signed-out defaults and clear the persisted key.
   * Called from `useAuth.signOut()` so a trainer's coach mode + eligibility
   * can't bleed into the next account signed in on the same device (the
   * STORAGE_KEY is device-global, not user-scoped).
   */
  reset: () => void;
}

export const useUserMode = create<UserModeState>((set, get) => ({
  mode: "athlete",
  isTrainerEligible: false,
  isEligibilityKnown: false,

  switchTo: async (next) => {
    const { isTrainerEligible } = get();
    if (next === "coach" && !isTrainerEligible) {
      console.warn(
        "[user-mode] switchTo(coach) called when not eligible — ignored",
      );
      return;
    }
    // The in-memory mode change is the user-visible effect and has already
    // applied above; persistence is best-effort. Swallow a disk failure
    // (full disk, RN bridge tear-down on background, permission revoke) with a
    // warning rather than letting it escape — both documented callers (the
    // Phase 14.2 invariant watchdog and the drawer mode-switch button) invoke
    // switchTo fire-and-forget, so an uncaught rejection would surface as a
    // "Possible Unhandled Promise Rejection". Matches setEligibility's forced
    // fall-back + useTrainSegment.setSegment, which swallow the same failure.
    set({ mode: next });
    await AsyncStorage.setItem(STORAGE_KEY, next).catch((err) => {
      console.warn("[user-mode] switchTo persist failed", err);
    });
  },

  setEligibility: (eligible) => {
    const { mode } = get();
    // `isEligibilityKnown: true` marks the subscription cache as resolved —
    // gates the invariant watchdog so it doesn't react to the default-false
    // before the network answer comes in.
    set({ isTrainerEligible: eligible, isEligibilityKnown: true });
    // Force fall-back to athlete if eligibility lost while in coach mode.
    if (!eligible && mode === "coach") {
      set({ mode: "athlete" });
      AsyncStorage.setItem(STORAGE_KEY, "athlete").catch(() => undefined);
    }
  },

  rehydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (isUserMode(stored)) {
        // Restore the persisted mode verbatim — DO NOT consult
        // isTrainerEligible here. On cold launch, AsyncStorage.getItem
        // (~ms) almost always resolves before useGetUserSubscription
        // (100–1000ms network), so `isTrainerEligible` is still the
        // default `false` regardless of the user's real subscription
        // status. Branching on it would demote legitimate trainers to
        // athlete + persist the demotion to disk (worse failure mode
        // than the original race). The invariant watchdog in RootLayout
        // handles eligibility enforcement once the network resolves.
        set({ mode: stored });
      }
    } catch (err) {
      console.warn("[user-mode] rehydrate failed", err);
    }
  },

  reset: () => {
    // Back to signed-out defaults + drop the persisted key so the next
    // account on this device starts as a fresh athlete. Disk clear is
    // best-effort (fire-and-forget, swallow) — the in-memory reset is the
    // user-visible effect and applies synchronously.
    set({
      mode: "athlete",
      isTrainerEligible: false,
      isEligibilityKnown: false,
    });
    AsyncStorage.removeItem(STORAGE_KEY).catch((err) => {
      console.warn("[user-mode] reset removeItem failed", err);
    });
  },
}));

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
    set({ mode: next });
    await AsyncStorage.setItem(STORAGE_KEY, next);
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
}));

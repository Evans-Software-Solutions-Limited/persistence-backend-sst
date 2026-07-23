import { router } from "expo-router";
import { useCallback } from "react";

import { useDrawer } from "@/state/drawer";
import { useUserMode, type UserMode } from "@/state/user-mode";

/**
 * useModeSwitch — the athlete↔coach mode-switch handler + tab-equivalent
 * remap.
 *
 * Spec: specs/14-navigation/design.md § Mode-switch animation
 *       specs/14-navigation/requirements.md STORY-003 (AC 3.7)
 *       specs/14-navigation/tasks.md T-14.6.1, T-14.6.3
 *
 * The mode-switch CARD lives in the ProfileDrawer (owned by
 * 08-profile-settings); it calls this handler. The handler owns the atomic
 * sequence so there's no flash of the wrong tabs (AC 3.7):
 *   1. closeDrawer() — the drawer slides down (250ms).
 *   2. switchTo(next) — writes `mode` SYNCHRONOUSLY (the store's `set` call
 *      happens before its internal `await` on the AsyncStorage persist), so
 *      <TabBar>/<TabsLayout> re-read it and swap the spec immediately.
 *   3. Remap the active tab to its equivalent in the new mode and navigate,
 *      so the user lands on a tab that exists in the new mode (a coach has no
 *      Train tab, etc.). Unmapped → Home.
 *
 * Navigate in the SAME tick as the mode flip (step 2/3 aren't separated by an
 * `await`) — only the disk-persist half of `switchTo` is left running in the
 * background. Gating navigation behind `await switchTo(next)` would defer it
 * behind that persist, leaving a window where `mode` has already flipped but
 * the previous mode's route is still focused (QA-17: a coach screen briefly
 * renders under athlete mode and its stranded-route guard flashes an error).
 *
 * `switchTo` is a no-op when switching to coach without eligibility, so the
 * remap/navigate is gated on the switch actually taking effect.
 */

/**
 * Tab-equivalent mapping across modes. Routes shared by both modes (index,
 * you) map to themselves. Athlete-only ↔ coach-only routes map to their
 * positional equivalent (Train↔Clients, Fuel↔Programs). Anything unmapped
 * falls back to Home (index).
 */
const ATHLETE_TO_COACH: Record<string, string> = {
  index: "index",
  train: "clients",
  fuel: "programs",
  you: "you",
};

const COACH_TO_ATHLETE: Record<string, string> = {
  index: "index",
  clients: "train",
  programs: "fuel",
  you: "you",
};

export function equivalentTab(activeRoute: string, next: UserMode): string {
  const map = next === "coach" ? ATHLETE_TO_COACH : COACH_TO_ATHLETE;
  return map[activeRoute] ?? "index";
}

export type UseModeSwitch = {
  /** Switch to `next` mode, remapping the active tab. `activeRoute` is the
   *  current tab route name (e.g. "train"); defaults to "index". */
  switchMode: (next: UserMode, activeRoute?: string) => Promise<void>;
};

export function useModeSwitch(): UseModeSwitch {
  const switchTo = useUserMode((s) => s.switchTo);
  const isTrainerEligible = useUserMode((s) => s.isTrainerEligible);
  const closeDrawer = useDrawer((s) => s.closeDrawer);

  const switchMode = useCallback(
    async (next: UserMode, activeRoute: string = "index") => {
      // Coach switch requires eligibility — bail before closing the drawer so
      // an ineligible tap leaves the UI untouched (switchTo also guards +
      // warns, but we avoid the drawer-close side effect here).
      if (next === "coach" && !isTrainerEligible) {
        return;
      }

      // 1. Close the drawer (slides down) before the tab spec swaps.
      closeDrawer();

      // 2. Kick off the mode switch. `switchTo` writes `mode` SYNCHRONOUSLY
      //    (before its internal `await` on the AsyncStorage persist) — don't
      //    `await` the call itself here, or the navigate below would be
      //    deferred behind the disk write, leaving `mode` already flipped
      //    while the previous mode's route is still focused (QA-17: a stale
      //    coach screen flashes an error under athlete mode). Persistence is
      //    awaited last instead, purely so callers can tell when it settles.
      const persist = switchTo(next);

      // 3. Land on the equivalent tab in the new mode, in the SAME tick as
      //    the (synchronous) mode flip above. The shared "index" tab
      //    resolves to the tabs DIRECTORY route `/(app)/(tabs)` — Expo Router
      //    treats `index.tsx` as that directory, not a child named "index",
      //    so `/(app)/(tabs)/index` resolves inconsistently. Match the
      //    convention used everywhere else (AuthGate, SubscriptionSuccess).
      const target = equivalentTab(activeRoute, next);
      const path =
        target === "index" ? "/(app)/(tabs)" : `/(app)/(tabs)/${target}`;
      router.navigate(path as never);

      await persist;
    },
    [switchTo, isTrainerEligible, closeDrawer],
  );

  return { switchMode };
}

import { FuelTargetsContainer } from "@/ui/containers/FuelTargetsContainer";

/**
 * The Fuel Targets editor, reachable from step 3 of the onboarding journey.
 *
 * ─── Why a second route to the same container ───
 *
 * Step 3 (`habits`) offers a Calories habit whose target is read-only, so its
 * only edit affordance is a link to this editor. The editor's own home is
 * `/(app)/fuel/targets` — but the root layout renders a `<Slot/>`, which mounts
 * only the focused group, so pushing from `(onboarding)` into `(app)` unmounts
 * the whole journey. Three things went wrong when it did:
 *
 *  1. `HabitSetupContainer` keeps its habit draft in `useState`, and enabling
 *     Calories is a draft-only change until step 3 is saved. Unmounting threw
 *     the toggle away, so the user came back to find Calories off again and
 *     the habit was never created — the fix would have looked like it worked
 *     while silently dropping the thing they set out to do.
 *  2. It mounted `(app)/_layout` for the first time mid-journey, running every
 *     bootstrap hook in it — including the notification cold-start dispatch,
 *     which pushes `/(app)/(tabs)` for a launching tap with no deep link and so
 *     bounced the user straight back out of the editor.
 *  3. It needed the root onboarding guard to be relaxed for an `(app)` route,
 *     which is a security-shaped change to make for a UI convenience.
 *
 * `(onboarding)` is a `Stack`, which keeps its history mounted, so a detour
 * route here preserves the draft, mounts nothing new, and needs no exemption:
 * `inOnboardingGroup` is already true, so the guard never fires. `router.back()`
 * returns to `habits` with the toggle still on.
 *
 * NOT an onboarding page. It is absent from `ONBOARDING_PAGES`, so it takes no
 * part in step numbering or progress, and `onboarding_states.current_page` —
 * whose CHECK constraint permits only the seven real pages — never holds it.
 */
export default function OnboardingFuelTargetsScreen() {
  return <FuelTargetsContainer onboarding />;
}

import { Redirect } from "expo-router";
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import { useLoadoutFlow } from "@/state/loadout-flow";
import { LoadoutFlowContainer } from "@/ui/containers/LoadoutFlowContainer";

/**
 * `/(app)/loadout` — the Premium+ "adapt this workout to your gym" flow
 * (spec-21 Phase 2/3).
 *
 * A ROUTE rather than a root-mounted overlay, because the entry point lives on
 * `workouts/[id]/index`, which is itself `presentation: "modal"`. See
 * `LoadoutFlowContainer`'s header for the two device failures that established
 * this — an absolute View rendered behind the workout sheet, and an RN Modal
 * froze the screen.
 *
 * ## ⚠ The `SafeAreaProvider` is load-bearing, and its absence is a real bug
 *
 * **This app mounts no `SafeAreaProvider` at its root.** Every other screen gets
 * away with that because `SafeAreaView` from `react-native-safe-area-context` is
 * a NATIVE view that measures its own window when no provider supplies insets —
 * so it works, right up until the view is not laid out against the window it
 * thinks it is.
 *
 * This route is `presentation: "fullScreenModal"`, which react-native-screens
 * presents as its own view controller. The native measurement inside that
 * controller resolves to ZERO, and inconsistently: the same `LoadoutScaffold`
 * rendered correctly inset on one device run and flush against the status bar on
 * the next, with the header text overlapping the clock. A measurement race is
 * exactly the shape of that inconsistency.
 *
 * A provider seeded with `initialWindowMetrics` removes the race rather than
 * narrowing it: the insets are the window's, they are available on the FIRST
 * frame (no zero-inset flash to correct), and every descendant — including the
 * scan and swap `BottomSheet`s, which read `SafeAreaInsetsContext` and until now
 * got `0` for the home indicator — reads the same values.
 *
 * ⚠ Scoped to this route deliberately. The right long-term fix is one provider
 * at the app root, but that changes the bottom inset of EVERY sheet in the app —
 * a real improvement, and not one to make inside a feature branch without a
 * device pass. Recorded in `STATE.md`.
 *
 * ⚠ The store is seeded BEFORE navigating (`useLoadoutFlow.open(id, name)` in
 * `WorkoutDetailContainer`), so arriving here with no `workoutId` means the
 * route was reached directly — a deep link, or a state restore after the store
 * was cleared. Redirect rather than render: the flow has no workout to adapt and
 * every step would show an empty shell.
 */
export default function LoadoutRoute() {
  const workoutId = useLoadoutFlow((state) => state.workoutId);
  if (workoutId === null) return <Redirect href="/(app)/(tabs)/train" />;
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <LoadoutFlowContainer />
    </SafeAreaProvider>
  );
}

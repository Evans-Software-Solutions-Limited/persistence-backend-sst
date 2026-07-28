import { Redirect } from "expo-router";
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
 * ⚠ The store is seeded BEFORE navigating (`useLoadoutFlow.open(id, name)` in
 * `WorkoutDetailContainer`), so arriving here with no `workoutId` means the
 * route was reached directly — a deep link, or a state restore after the store
 * was cleared. Redirect rather than render: the flow has no workout to adapt and
 * every step would show an empty shell.
 */
export default function LoadoutRoute() {
  const workoutId = useLoadoutFlow((state) => state.workoutId);
  if (workoutId === null) return <Redirect href="/(app)/(tabs)/train" />;
  return <LoadoutFlowContainer />;
}

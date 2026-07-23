import { useLocalSearchParams } from "expo-router";
import { AthleteProgramContainer } from "@/ui/containers/AthleteProgramContainer";

/**
 * Athlete-facing programme detail (specs/19-programs — athlete view). A
 * read-only window into an assigned programme: its summary + the workouts in
 * the plan, each openable to start. Sibling of the `(tabs)` group so it pushes
 * OVER the tab bar. Distinct from the coach editor at `/programs/[id]`.
 */
export default function AthleteProgramRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AthleteProgramContainer programId={id} />;
}

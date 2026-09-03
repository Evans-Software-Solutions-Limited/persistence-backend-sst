import { WorkoutCreatorContainer } from "@/ui/containers/WorkoutCreatorContainer";
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";

export default function WorkoutCreateRoute() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <WorkoutCreatorContainer />
    </SafeAreaProvider>
  );
}

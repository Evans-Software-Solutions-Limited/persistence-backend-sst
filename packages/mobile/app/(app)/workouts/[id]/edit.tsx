import { WorkoutEditorContainer } from "@/ui/containers/WorkoutEditorContainer";
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";

export default function WorkoutEditRoute() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <WorkoutEditorContainer />
    </SafeAreaProvider>
  );
}

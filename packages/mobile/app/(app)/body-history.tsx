import { useLocalSearchParams } from "expo-router";
import {
  BodyHistoryContainer,
  type BodyHistoryMetric,
} from "@/ui/containers/BodyHistoryContainer";

export default function BodyHistoryScreen() {
  // Compatibility route retained for old notifications/deep links.
  const { metric } = useLocalSearchParams<{ metric?: string }>();
  const resolvedMetric: BodyHistoryMetric =
    metric === "bodyFat" ? "bodyFat" : "weight";
  return <BodyHistoryContainer metric={resolvedMetric} />;
}

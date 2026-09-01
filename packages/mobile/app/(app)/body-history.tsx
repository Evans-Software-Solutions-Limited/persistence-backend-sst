import { BodyHistoryContainer } from "@/ui/containers/BodyHistoryContainer";

export default function BodyHistoryScreen() {
  // Compatibility route retained for old notifications/deep links.
  return <BodyHistoryContainer metric="weight" />;
}

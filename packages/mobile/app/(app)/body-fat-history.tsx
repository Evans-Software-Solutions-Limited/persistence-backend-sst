import { Redirect } from "expo-router";
import { BodyHistoryContainer } from "@/ui/containers/BodyHistoryContainer";
import { isExperiencePolishEnabled } from "@/ui/state/experiencePolish";

export default function BodyFatHistoryScreen() {
  if (!isExperiencePolishEnabled()) {
    return <Redirect href={"/(app)/body-history" as never} />;
  }
  return <BodyHistoryContainer metric="bodyFat" />;
}

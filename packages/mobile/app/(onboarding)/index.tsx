import { Redirect, type Href } from "expo-router";

export default function OnboardingIndexRoute() {
  return <Redirect href={"/(onboarding)/welcome" as Href} />;
}

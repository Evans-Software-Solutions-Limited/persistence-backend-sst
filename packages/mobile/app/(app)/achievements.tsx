import { AchievementsContainer } from "@/ui/containers/AchievementsContainer";

/**
 * Achievements screen (06-progress-goals). Reached from the profile
 * drawer's "Achievements" row — was a `coming-soon?feature=achievements`
 * placeholder; now a real screen composed from the existing
 * Milestones/PRHistory presenters (see AchievementsContainer/Presenter).
 *
 * Renders no <HeaderBar> of its own, so it opts into the native header
 * (title set in app/(app)/_layout.tsx) for the title + back affordance —
 * same convention as the `coming-soon` route.
 */
export default function AchievementsScreen() {
  return <AchievementsContainer />;
}

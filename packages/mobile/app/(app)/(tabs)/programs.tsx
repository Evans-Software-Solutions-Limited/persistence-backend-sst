import { CoachLibraryHubContainer } from "@/ui/containers/CoachLibraryHubContainer";

/**
 * Programs tab — coach-mode only (specs/19-programs STORY-002). Visibility is
 * gated to coach mode by `<TabsLayout>` (href: null in athlete mode); the
 * programme editor + assign flows live as sibling routes under
 * `app/(app)/programs/*`.
 *
 * specs/24-coach-authoring STORY-001: the tab now renders the unified coach
 * library hub (Programmes | Workouts | Exercises) instead of the bare
 * programmes list.
 */
export default function ProgramsTab() {
  return <CoachLibraryHubContainer />;
}

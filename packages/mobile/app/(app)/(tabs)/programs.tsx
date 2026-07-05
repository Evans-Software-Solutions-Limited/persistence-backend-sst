import { ProgramsListContainer } from "@/ui/containers/ProgramsListContainer";

/**
 * Programs tab — coach-mode only (specs/19-programs STORY-002). Visibility is
 * gated to coach mode by `<TabsLayout>` (href: null in athlete mode); the
 * programme editor + assign flows live as sibling routes under
 * `app/(app)/programs/*`.
 */
export default function ProgramsTab() {
  return <ProgramsListContainer />;
}

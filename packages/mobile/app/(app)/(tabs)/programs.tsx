import { ComingSoon } from "@/ui/components/ComingSoon";

/**
 * Programs tab — coach-mode only. Placeholder until M8.
 *
 * Spec: specs/14-navigation/design.md § Route migration table (programs.tsx)
 *       specs/14-navigation/requirements.md STORY-002 (AC 2.6 — Programs half)
 *
 * Registered as a route so deep links + programmatic navigation resolve;
 * visibility is gated to coach mode by `<TabsLayout>` (Phase 14.4). Real
 * Programs UI is owned by `10-trainer-features`.
 */
export default function ProgramsTab() {
  return (
    <ComingSoon
      icon="albums-outline"
      title="Programs"
      description="Programme building arrives in milestone M8 (10-trainer-features)."
      testID="programs-tab"
    />
  );
}

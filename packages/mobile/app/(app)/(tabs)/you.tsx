import { YouContainer } from "@/ui/containers/YouContainer";

/**
 * You tab — athlete Progress + identity surface (absorbs the legacy
 * Progress tab; Profile moves to the ProfileDrawer).
 *
 * Spec: specs/14-navigation/design.md § Route migration table (you.tsx)
 *       specs/14-navigation/requirements.md STORY-001 (AC 1.2)
 *
 * Content owned by `06-progress-goals` (athlete) / `10-trainer-features`
 * (coach). This spec reserves the slot; YouContainer is a stub until then.
 */
export default function YouTab() {
  return <YouContainer />;
}

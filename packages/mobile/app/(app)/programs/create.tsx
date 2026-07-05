import { ProgramEditorContainer } from "@/ui/containers/ProgramEditorContainer";

/**
 * New-programme editor (specs/19-programs STORY-001). Sibling of the `(tabs)`
 * group so it pushes OVER the tab bar (mirrors `workouts/create`). Coach-only —
 * the container redirects a non-coach to the tabs index.
 */
export default function CreateProgramRoute() {
  return <ProgramEditorContainer />;
}

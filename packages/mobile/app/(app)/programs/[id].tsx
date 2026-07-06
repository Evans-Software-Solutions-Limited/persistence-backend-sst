import { useLocalSearchParams } from "expo-router";
import { ProgramEditorContainer } from "@/ui/containers/ProgramEditorContainer";

/**
 * Edit-programme editor (specs/19-programs STORY-001). Sibling of the `(tabs)`
 * group so it pushes OVER the tab bar. Coach-only — the container redirects a
 * non-coach to the tabs index.
 */
export default function EditProgramRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProgramEditorContainer programId={id} />;
}

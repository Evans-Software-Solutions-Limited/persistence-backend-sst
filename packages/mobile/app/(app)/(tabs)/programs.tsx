import { Redirect } from "expo-router";

/**
 * The old coach Programs tab (specs/19-programs STORY-002). PER-129's K
 * shell moved programmes into Library → Programmes; this route stays so
 * existing links and pushes still land there.
 */
export default function ProgramsTab() {
  return (
    <Redirect href={"/(app)/(tabs)/library?segment=programmes" as never} />
  );
}

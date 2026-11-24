import { Redirect } from "expo-router";
import { useEffect } from "react";

import { useCoachLibraryTab } from "@/state/coach-library-tab";

/**
 * The old coach Programs tab (specs/19-programs STORY-002). PER-129's K
 * shell moved programmes into Library → Programmes; this route stays so
 * existing links and pushes still land there.
 *
 * The Library tab stays mounted, so a repeat redirect with the same
 * `?segment=` doesn't re-run its param effect: set its segment as well
 * (Inspector Brad #556 sweep 2). In an effect, not during render: the
 * mounted Library subscribes to it.
 */
export default function ProgramsTab() {
  useEffect(() => {
    useCoachLibraryTab.getState().setSegment("programmes");
  }, []);
  return (
    <Redirect href={"/(app)/(tabs)/library?segment=programmes" as never} />
  );
}

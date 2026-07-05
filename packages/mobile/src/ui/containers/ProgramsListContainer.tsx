import { useCallback, useMemo, useState } from "react";
import { router } from "expo-router";
import { useGetPrograms } from "@/ui/hooks/useGetPrograms";
import {
  ProgramsListPresenter,
  type ProgramSegment,
} from "@/ui/presenters/coach/ProgramsListPresenter";

/**
 * Coach "Programmes" tab container (specs/19-programs STORY-002). Replaces the
 * `ComingSoon` stub with the real library: cache-first `useGetPrograms()` wired
 * into <ProgramsListPresenter> with local search + Active/Drafts segment state.
 *
 * The tab is only reachable in coach mode (tab-level href gating), and the
 * programme endpoints are trainer-role-gated server-side, so no extra
 * subscription/feature gate is layered here — an entitlement lapse surfaces as
 * the presenter's error state. Header "+" and the dashed CTA both route to the
 * create editor; a row press opens the edit editor.
 */
export function ProgramsListContainer() {
  const programsState = useGetPrograms();

  const [searchQuery, setSearchQuery] = useState("");
  const [segment, setSegment] = useState<ProgramSegment>("Active");

  const programs = useMemo(
    () => programsState.data ?? [],
    [programsState.data],
  );

  const onCreate = useCallback(() => {
    router.push("/(app)/programs/create");
  }, []);

  const onOpenProgram = useCallback((id: string) => {
    router.push(`/(app)/programs/${id}`);
  }, []);

  return (
    <ProgramsListPresenter
      programs={programs}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      segment={segment}
      onSegmentChange={setSegment}
      isLoading={
        (programsState.isRefreshing ||
          (programsState.isStale && programsState.error === null)) &&
        programsState.data === null
      }
      isRefreshing={programsState.isRefreshing}
      error={programsState.error}
      onRefresh={programsState.refresh}
      onCreate={onCreate}
      onOpenProgram={onOpenProgram}
      testID="programs-list"
    />
  );
}

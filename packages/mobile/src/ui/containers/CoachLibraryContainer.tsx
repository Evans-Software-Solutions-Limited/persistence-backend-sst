import { useCallback, useEffect, useMemo } from "react";
import { ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useCoachLibraryTab } from "@/state/coach-library-tab";
import {
  groupLibrary,
  type LibrarySectionKey,
} from "@/domain/services/coachForms.service";
import {
  useCoachFormConflicts,
  useCoachFormSchedules,
  useCoachFormStats,
  useCoachFormsLibrary,
} from "@/ui/hooks/useCoachForms";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { CoachLibraryHubContainer } from "@/ui/containers/CoachLibraryHubContainer";
import {
  CoachLibraryPresenter,
  isLibrarySegment,
  LIBRARY_SEGMENT_LABELS,
} from "@/ui/presenters/coachForms/CoachLibraryPresenter";
import { FormsLibraryPresenter } from "@/ui/presenters/coachForms/FormsLibraryPresenter";
import { InDevelopment } from "@/ui/presenters/coachForms/kit";

/** Which trigger the send sheet starts on after "+ Add" in a C10g section. */
export const SECTION_TRIGGER: Partial<Record<LibrarySectionKey, string>> = {
  on_join: "on_join",
  repeating: "weekly",
};

/** C10g — the Forms segment's body. */
export function CoachFormsLibraryContainer() {
  const router = useRouter();
  const library = useCoachFormsLibrary();
  const schedules = useCoachFormSchedules();
  const stats = useCoachFormStats();
  const { conflicts } = useCoachFormConflicts();
  const online = useOnlineStatus();

  const sections = useMemo(
    () =>
      groupLibrary(
        library.data?.forms ?? [],
        schedules.data ?? [],
        stats.data,
        conflicts,
      ),
    [library.data, schedules.data, stats.data, conflicts],
  );

  const onRefresh = useCallback(() => {
    void library.refresh();
    void schedules.refresh();
    void stats.refresh();
  }, [library, schedules, stats]);

  return (
    <FormsLibraryPresenter
      sections={sections}
      isLoading={library.data === null && library.error === null}
      isRefreshing={library.isRefreshing}
      offline={!online}
      onRefresh={onRefresh}
      onOpen={(formId) =>
        router.push({
          pathname: "/(app)/coach-forms/[id]",
          params: { id: formId },
        } as never)
      }
      onAdd={(section) => {
        const trigger = SECTION_TRIGGER[section];
        router.push({
          pathname: "/(app)/coach-forms/edit",
          params: trigger ? { trigger } : {},
        } as never);
      }}
    />
  );
}

const PLACEHOLDER_TICKETS: Partial<Record<string, string>> = {
  resources: "PER-122",
};

/**
 * PER-129 K shell — the coach Library tab. Forms is live (C10g), Programmes
 * is the existing programmes hub, the rest are marked "In development".
 * `?segment=` (e.g. the old Programs tab's redirect) picks the segment.
 */
export function CoachLibraryContainer() {
  const router = useRouter();
  const { segment: param } = useLocalSearchParams<{ segment?: string }>();
  const segment = useCoachLibraryTab((s) => s.segment);
  const setSegment = useCoachLibraryTab((s) => s.setSegment);

  useEffect(() => {
    if (isLibrarySegment(param)) setSegment(param);
  }, [param, setSegment]);

  return (
    <CoachLibraryPresenter
      segment={segment}
      onSegment={setSegment}
      onNewForm={() => router.push("/(app)/coach-forms/edit" as never)}
    >
      {segment === "forms" ? (
        <CoachFormsLibraryContainer />
      ) : segment === "programmes" ? (
        <CoachLibraryHubContainer embedded />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20 }}>
          <InDevelopment
            title={LIBRARY_SEGMENT_LABELS[segment]}
            ticket={PLACEHOLDER_TICKETS[segment]}
            testID={`coach-library-placeholder-${segment}`}
          />
        </ScrollView>
      )}
    </CoachLibraryPresenter>
  );
}

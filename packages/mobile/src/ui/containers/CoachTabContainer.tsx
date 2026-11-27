import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { firstName, type MyCoach } from "@/domain/models/myCoaching";
import {
  coachFormsView,
  joiningForms,
  offlineLine,
  shouldShowJoinIntro,
} from "@/domain/services/athleteForms.service";
import { useAthleteForms } from "@/ui/hooks/useAthleteForms";
import { useMyCoaches } from "@/ui/hooks/useMyCoaches";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  CoachTabPresenter,
  type CoachTabCoach,
} from "@/ui/presenters/CoachTabPresenter";
import { CoachFormsSection } from "@/ui/presenters/athleteForms/CoachFormsSection";
import { coachInitials } from "@/ui/presenters/coaching/coachingKit";
import { resourcesFromCoach } from "@/domain/services/coachResources.service";
import { useMyResources } from "@/ui/hooks/useCoachResources";
import { useOpenResource } from "@/ui/containers/coachResources/useOpenResource";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * C2e "Coaching you since August"; C11k "Your coach from today" on the day
 * coaching starts. The year is added once it isn't this year.
 */
export function coachingSince(since: string | null, now: Date): string {
  const d = since ? new Date(since) : null;
  if (!d || Number.isNaN(d.getTime())) return "Your coach";
  if (d.toDateString() === now.toDateString()) return "Your coach from today";
  const month = MONTHS[d.getMonth()]!;
  return d.getFullYear() === now.getFullYear()
    ? `Coaching you since ${month}`
    : `Coaching you since ${month} ${d.getFullYear()}`;
}

export function toCoachTabCoach(c: MyCoach, now: Date): CoachTabCoach {
  return {
    id: c.relationshipId,
    trainerId: c.trainerId,
    name: c.name,
    firstName: firstName(c.name),
    initials: coachInitials(c.name) || "?",
    subtitle: coachingSince(c.since, now),
  };
}

/**
 * <CoachTabContainer> — the athlete Coach tab (PER-126). Cache-first from
 * `cached_my_coaches`, so it works offline; refreshes on focus. Opens on the
 * coach named by `?coachId=` (You → Coaching row), else the first coach.
 * When a coach is removed (ended coaching), the selection falls back to the
 * next coach; with none left the tab layout hides the tab.
 *
 * PER-130: the selected coach's due forms lead the tab (C10p/r), from
 * `cached_form_requests` so they show offline. While that coach's joining
 * forms are untouched, C10q opens by itself once, when the tab is in view.
 */
export function CoachTabContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ coachId?: string; nav?: string }>();
  // Each You → Coaching tap carries its own `nav` key, so tapping the same
  // coach again still wins over an earlier chip choice (Inspector Brad, #547).
  const navKey =
    params.coachId === undefined
      ? undefined
      : `${params.coachId}|${params.nav ?? ""}`;
  const my = useMyCoaches();
  const forms = useAthleteForms();
  const online = useOnlineStatus();
  // A chip tap wins until the next You → Coaching navigation.
  const [picked, setPicked] = useState<{
    id: string;
    param: string | undefined;
  } | null>(null);
  const [focused, setFocused] = useState(false);

  const coaches = useMemo(() => {
    const now = new Date();
    return my.coaches.map((c) => toCoachTabCoach(c, now));
  }, [my.coaches]);

  const wanted =
    picked && picked.param === navKey ? picked.id : (params.coachId ?? null);
  const selected = coaches.find((c) => c.id === wanted) ?? coaches[0] ?? null;

  const refresh = my.refresh;
  const refreshForms = forms.refresh;
  // PER-143: the selected coach's resources, cache-first.
  const resources = useMyResources();
  const openResource = useOpenResource(resources);
  const refreshResources = resources.refresh;
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void refresh({ silent: true });
      void refreshForms({ silent: true });
      void refreshResources({ silent: true });
      return () => setFocused(false);
    }, [refresh, refreshForms, refreshResources]),
  );
  const coachResources = useMemo(
    () =>
      resources.data && selected
        ? resourcesFromCoach(resources.data, selected.trainerId)
        : null,
    [resources.data, selected],
  );

  const view = useMemo(
    () =>
      selected
        ? coachFormsView({
            requests: forms.requests,
            locals: forms.locals,
            coachId: selected.trainerId,
          })
        : null,
    [selected, forms.requests, forms.locals],
  );

  // C10q: open the joining forms page once per coach, while none of them
  // has been seen there or started ("Later" marks them seen).
  const introOpened = useRef(new Set<string>());
  const coachId = selected?.trainerId ?? null;
  const showIntro = useMemo(
    () =>
      coachId !== null &&
      shouldShowJoinIntro(
        joiningForms(forms.requests, forms.locals, coachId),
        forms.locals,
      ),
    [coachId, forms.requests, forms.locals],
  );
  useEffect(() => {
    if (!focused || !showIntro || coachId === null) return;
    if (introOpened.current.has(coachId)) return;
    introOpened.current.add(coachId);
    router.push({
      pathname: "/(app)/forms/joining",
      params: { coachId },
    } as never);
  }, [focused, showIntro, coachId, router]);

  return (
    <CoachTabPresenter
      coaches={coaches}
      selected={selected}
      isLoading={my.data === null}
      isRefreshing={my.isRefreshing}
      onSelect={(id) => setPicked({ id, param: navKey })}
      onRefresh={() => {
        void refresh();
        void refreshForms({ silent: true });
        void refreshResources();
      }}
      forms={
        view ? (
          <CoachFormsSection
            toFill={view.toFill}
            done={view.done}
            offlineNote={
              !online &&
              (view.toFill.length > 0 || view.waitingTitles.length > 0)
                ? offlineLine(view.waitingTitles)
                : null
            }
            onOpen={(requestId) =>
              router.push({
                pathname: "/(app)/forms/[id]",
                params: { id: requestId },
              } as never)
            }
          />
        ) : null
      }
      resources={coachResources}
      onOpenResource={(id) => void openResource(id)}
    />
  );
}

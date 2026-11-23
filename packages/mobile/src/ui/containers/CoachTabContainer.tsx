import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { firstName, type MyCoach } from "@/domain/models/myCoaching";
import { useMyCoaches } from "@/ui/hooks/useMyCoaches";
import {
  CoachTabPresenter,
  type CoachTabCoach,
} from "@/ui/presenters/CoachTabPresenter";
import { coachInitials } from "@/ui/presenters/coaching/coachingKit";

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
 */
export function CoachTabContainer() {
  const params = useLocalSearchParams<{ coachId?: string }>();
  const my = useMyCoaches();
  // A chip tap wins until You → Coaching opens the tab on another coach.
  const [picked, setPicked] = useState<{
    id: string;
    param: string | undefined;
  } | null>(null);

  const coaches = useMemo(() => {
    const now = new Date();
    return my.coaches.map((c) => toCoachTabCoach(c, now));
  }, [my.coaches]);

  const wanted =
    picked && picked.param === params.coachId
      ? picked.id
      : (params.coachId ?? null);
  const selected = coaches.find((c) => c.id === wanted) ?? coaches[0] ?? null;

  const refresh = my.refresh;
  useFocusEffect(
    useCallback(() => {
      void refresh({ silent: true });
    }, [refresh]),
  );

  return (
    <CoachTabPresenter
      coaches={coaches}
      selected={selected}
      isLoading={my.data === null}
      isRefreshing={my.isRefreshing}
      onSelect={(id) => setPicked({ id, param: params.coachId })}
      onRefresh={() => void refresh()}
    />
  );
}

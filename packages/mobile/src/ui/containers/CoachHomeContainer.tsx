import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetTrainerClients } from "@/ui/hooks/useGetTrainerClients";
import { useGetStreaks } from "@/ui/hooks/useGetStreaks";
import { useGetHome } from "@/ui/hooks/useGetHome";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { useModeSwitch } from "@/ui/hooks/useModeSwitch";
import { useDrawer } from "@/state/drawer";
import { useAddClientSheet } from "@/state/add-client-sheet";
import { initialsOf, timeGreeting } from "@/shared/utils";
import type { Streak } from "@/domain/models/streak";
import type { TrainerClient } from "@/domain/models/trainerClient";
import type { HomePayload } from "@/domain/models/progress";
import type { FlaggedClientVM } from "@/ui/presenters/coach/FlaggedClientsPresenter";
import type { ProgrammeAlertVM } from "@/ui/presenters/coach/ProgrammeAlertsPresenter";
import { CoachHomePresenter } from "@/ui/presenters/CoachHomePresenter";

/**
 * <CoachHomeContainer> — the coach-mode Home tab (10-trainer-features Phase 10).
 * The daily TRIAGE screen: who needs the coach today, which programmes are
 * ending, and a shortcut to train yourself. Replaces the old <ComingSoon> stub.
 *
 * Data is 100% derived client-side from the existing `GET /trainers/me/clients`
 * roster (`useGetTrainerClients`) + athlete-mode streak/home hooks — there is
 * NO Coach-Home-specific backend (`GET /trainers/me/overview` is Coach You's
 * dashboard, not this). The schedule hero is deferred (no appointments backend
 * — Brad decision #1); the container never passes `schedule`.
 *
 * Container owns the hooks + view-model derivation; <CoachHomePresenter> is a
 * pure props bag. Top safe-area inset is owned by the tab route
 * (`app/(app)/(tabs)/index.tsx`), not here.
 */

/** Flagged = at-risk/crisis band OR any roster flag. Capped, worst-first
 *  (roster arrives adherence-ascending). */
const FLAGGED_LIMIT = 4;
/** A programme within this many days of its end date raises an alert. */
export const PROGRAMME_ALERT_WINDOW_DAYS = 14;
/** Within this many days the alert escalates to the ember (urgent) tone. */
const PROGRAMME_ALERT_URGENT_DAYS = 7;
/** Cap the alerts list so Home stays a triage glance, not a full list. */
const PROGRAMME_ALERT_LIMIT = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];
const MONTHS_SHORT = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

/** Header date eyebrow, e.g. "MONDAY · MAR 25" (viewer-local calendar day). */
export function buildDateLabel(now: Date): string {
  return `${WEEKDAYS[now.getDay()]} · ${MONTHS_SHORT[now.getMonth()]} ${now.getDate()}`;
}

/** Compose a flagged client's tone (flag tone first, else band-derived). */
function flaggedTone(client: TrainerClient): FlaggedClientVM["tone"] {
  if (client.flags.length > 0) return client.flags[0].tone;
  return client.band === "crisis" ? "error" : "ember";
}

/** Compose the "4d IDLE · Cut wk 6" subtitle from flags + programme label. */
function flaggedSub(client: TrainerClient): string {
  const parts = client.flags.map((f) => f.label);
  if (parts.length === 0) {
    parts.push(client.band === "crisis" ? "Needs attention" : "At risk");
  }
  if (client.programLabel) parts.push(client.programLabel);
  return parts.join(" · ");
}

/** Derive the "Needs you today" list: at-risk/crisis band or any flag. */
export function buildFlaggedClients(
  clients: TrainerClient[],
): FlaggedClientVM[] {
  return clients
    .filter(
      (c) => c.band === "atRisk" || c.band === "crisis" || c.flags.length > 0,
    )
    .slice(0, FLAGGED_LIMIT)
    .map((c) => ({
      clientId: c.id,
      name: c.name,
      initials: c.initials,
      sub: flaggedSub(c),
      tone: flaggedTone(c),
    }));
}

/**
 * Whole days from `now` until `iso` (negative when already past). Assumes the
 * Programs backend emits `programEndDate` as a full ISO timestamp; a date-only
 * string would parse as UTC midnight and could shift the "ends today/tomorrow"
 * boundary by a day for viewers far from UTC (documented, dormant until the
 * field is wired into this path).
 */
function daysUntil(iso: string, now: number): number | null {
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - now) / DAY_MS);
}

/** "ends today" | "ends tomorrow" | "ends in N days" | "ends in N weeks". */
function endsPhrase(days: number): string {
  if (days <= 0) return "ends today";
  if (days === 1) return "ends tomorrow";
  if (days < 7) return `ends in ${days} days`;
  const weeks = Math.round(days / 7);
  return `ends in ${weeks} week${weeks === 1 ? "" : "s"}`;
}

/** Programme name portion of the roster label ("Strength · Wk 4 / 12" → "Strength"). */
function programmeName(label: string | null): string {
  if (!label) return "Programme";
  return label.split(" · ")[0].trim() || "Programme";
}

/**
 * Derive the "Programme alerts" list: clients whose live programme ends within
 * the alert window. `programEndDate` may be absent on payloads cached before
 * 19-programs — tolerate that (skip). Soonest-first, capped.
 */
export function buildProgrammeAlerts(
  clients: TrainerClient[],
  now: number,
): ProgrammeAlertVM[] {
  const alerts: (ProgrammeAlertVM & { days: number })[] = [];
  for (const c of clients) {
    const iso = c.programEndDate ?? null;
    if (!iso) continue;
    const days = daysUntil(iso, now);
    if (days === null || days < 0 || days > PROGRAMME_ALERT_WINDOW_DAYS) {
      continue;
    }
    alerts.push({
      clientId: c.id,
      client: c.name,
      text: `${programmeName(c.programLabel)} ${endsPhrase(days)}`,
      tone: days <= PROGRAMME_ALERT_URGENT_DAYS ? "ember" : "trainer",
      days,
    });
  }
  return alerts
    .sort((a, b) => a.days - b.days)
    .slice(0, PROGRAMME_ALERT_LIMIT)
    .map(({ days: _days, ...rest }) => rest);
}

/** Pick the workout streak to feature, else the first. */
function pickWorkoutStreak(streaks: Streak[]): Streak | null {
  return (
    streaks.find((s) => s.streakType === "workout_streak") ?? streaks[0] ?? null
  );
}

/** First queued workout name from today's training, else the active programme. */
function queuedWorkoutName(home: HomePayload | null): string | null {
  if (!home) return null;
  const withName = home.todaysTraining.find((t) => (t.name ?? "").trim());
  if (withName?.name) return withName.name.trim();
  return home.activeProgramme?.name?.trim() || null;
}

/** "Switch to athlete view · N-day streak · <workout> queued" (segments elide). */
export function buildTrainYourselfSubtitle(
  streakCount: number,
  streakUnit: string,
  queuedName: string | null,
): string {
  const parts = ["Switch to athlete view"];
  if (streakCount > 0) {
    parts.push(`${streakCount}-${streakUnit} streak`);
  }
  if (queuedName) parts.push(`${queuedName} queued`);
  return parts.join(" · ");
}

export function CoachHomeContainer() {
  const router = useRouter();
  const { session } = useAuth();

  const clients = useGetTrainerClients();
  const streaks = useGetStreaks();
  const home = useGetHome();
  const profile = useProfilePage();
  const { switchMode } = useModeSwitch();
  const openDrawer = useDrawer((s) => s.openDrawer);
  const openSheet = useAddClientSheet((s) => s.openSheet);

  const fullName = profile.payload?.profile.fullName ?? null;
  const initials = useMemo(
    () => initialsOf(fullName ?? session?.email ?? "") || "?",
    [fullName, session?.email],
  );

  // `now` is intentionally per-render (not memoised): the date label + alert
  // windowing want the current clock, and both are O(roster) cheap. Memoising
  // them on a per-render `now` would only churn the cache, never hit it.
  const dateLabel = buildDateLabel(new Date());
  const greeting = timeGreeting();

  const roster = useMemo(() => clients.data ?? [], [clients.data]);
  const hasClients = roster.length > 0;

  const flaggedClients = useMemo(() => buildFlaggedClients(roster), [roster]);
  const programmeAlerts = buildProgrammeAlerts(roster, Date.now());

  const primaryStreak = useMemo(
    () => pickWorkoutStreak(streaks.data ?? []),
    [streaks.data],
  );
  const trainYourselfSubtitle = useMemo(() => {
    const count = primaryStreak?.currentCount ?? 0;
    const unit = primaryStreak?.period === "weekly" ? "week" : "day";
    return buildTrainYourselfSubtitle(
      count,
      unit,
      queuedWorkoutName(home.data),
    );
  }, [primaryStreak, home.data]);

  const refreshClients = clients.refresh;
  const refreshStreaks = streaks.refresh;
  const refreshHome = home.refresh;
  const onRefresh = useCallback(() => {
    // Fire-and-forget; the cache-first hooks own their own error state, so a
    // rejection here is a no-op rather than an unhandled promise.
    void Promise.all([refreshClients(), refreshStreaks(), refreshHome()]).catch(
      () => {},
    );
  }, [refreshClients, refreshStreaks, refreshHome]);

  const onOpenClient = useCallback(
    (clientId: string) => {
      router.push(`/(app)/clients/${clientId}` as never);
    },
    [router],
  );
  const onOpenClients = useCallback(() => {
    router.navigate("/(app)/(tabs)/clients" as never);
  }, [router]);
  const onOpenNotifications = useCallback(() => {
    router.push("/(app)/notifications" as never);
  }, [router]);
  const onTrainYourself = useCallback(() => {
    void switchMode("athlete", "index");
  }, [switchMode]);
  const onInviteClient = useCallback(() => {
    openSheet(() => {
      void refreshClients();
    });
  }, [openSheet, refreshClients]);

  return (
    <CoachHomePresenter
      dateLabel={dateLabel}
      greeting={greeting}
      initials={initials}
      hasClients={hasClients}
      flaggedClients={flaggedClients}
      programmeAlerts={programmeAlerts}
      trainYourselfSubtitle={trainYourselfSubtitle}
      isLoading={
        (clients.isRefreshing || (clients.isStale && clients.error === null)) &&
        clients.data === null
      }
      isRefreshing={clients.isRefreshing}
      error={clients.error}
      onRefresh={onRefresh}
      onOpenDrawer={openDrawer}
      onOpenNotifications={onOpenNotifications}
      onOpenClient={onOpenClient}
      onOpenClients={onOpenClients}
      onTrainYourself={onTrainYourself}
      onInviteClient={onInviteClient}
    />
  );
}

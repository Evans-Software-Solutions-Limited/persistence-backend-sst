import { Stack } from "expo-router";
import { ActiveWorkoutOverlay } from "../../src/ui/containers/ActiveWorkoutOverlay";
import { AddClientSheetContainer } from "../../src/ui/containers/AddClientSheetContainer";
import { AssignGoalSheet } from "../../src/ui/presenters/coach/AssignGoalSheet";
import { CoachNoteSheet } from "../../src/ui/presenters/coach/CoachNoteSheet";
import { SendBriefSheet } from "../../src/ui/presenters/coach/SendBriefSheet";
import { SwapWorkoutSheet } from "../../src/ui/presenters/coach/SwapWorkoutSheet";
import { AssignProgramSheet } from "../../src/ui/presenters/coach/AssignProgramSheet";
import { AssignWorkoutSheet } from "../../src/ui/presenters/coach/AssignWorkoutSheet";
import { EditNutritionTargetsSheet } from "../../src/ui/presenters/coach/EditNutritionTargetsSheet";
import { GoalSheet } from "../../src/ui/presenters/GoalSheet";
import { ProfileDrawerContainer } from "../../src/ui/containers/ProfileDrawerContainer";
import { QuickAddSheetContainer } from "../../src/ui/containers/QuickAddSheetContainer";
import { ScanBarcodeSheetContainer } from "../../src/ui/containers/ScanBarcodeSheetContainer";
import { SnapAISheetContainer } from "../../src/ui/containers/SnapAISheetContainer";
import { ExerciseFiltersProvider } from "../../src/ui/hooks/useExerciseFilters";
import { useAutoRetryOnUpgrade } from "../../src/ui/hooks/useAutoRetryOnUpgrade";
import { useHealthBodyPushSync } from "../../src/ui/hooks/useHealthBodyPushSync";
import { useNotificationBadge } from "../../src/ui/hooks/useNotificationBadge";
import { useNotificationDeepLink } from "../../src/ui/hooks/useNotificationDeepLink";
import { useSyncWorker } from "../../src/ui/hooks/useSyncWorker";
import { colorPalette } from "../../src/ui/theme";

/**
 * Routing structure — please preserve when refactoring:
 *
 *   app/(app)/
 *   ├── _layout.tsx                      <-- this file (Stack)
 *   ├── (tabs)/
 *   │   ├── _layout.tsx                  Tabs navigator (Home / Progress / …)
 *   │   ├── exercises.tsx                Exercises TAB (browse + filter rail)
 *   │   └── …
 *   └── exercises/
 *       ├── [id].tsx                     Detail — pushes OVER the tab bar
 *       ├── create.tsx                   Creator — pushes OVER the tab bar
 *       └── filters.tsx                  Modal — presented OVER the tab bar
 *
 * The exercises stack screens live as SIBLINGS of the `(tabs)` group, not
 * nested inside it. This is Expo Router's standard "push over tabs" pattern:
 * the Stack here matches `exercises/[id]`, `exercises/create`, and
 * `exercises/filters` as direct children before descending into `(tabs)`,
 * so `router.push("/(app)/exercises/filters")` resolves correctly despite
 * the tab also being named `exercises`.
 *
 * If you ever move the detail/create/filters files INTO `(tabs)/exercises/`
 * they will render inside the tab bar instead of pushing over it — not what
 * we want. Keep them here.
 */
export default function AppLayout() {
  // Drain the sync queue on launch + on every foreground transition.
  // Mounted at the authenticated layout root so it runs for the entire
  // signed-in surface and unmounts cleanly on sign-out (auth boundary
  // unmounts this tree).
  useSyncWorker();
  // M10.6: on a tier upgrade that satisfies blocked entries' verdict,
  // unblock them and flush. Runs alongside the sync worker — they
  // don't interact directly, but `useAutoRetryOnUpgrade` triggers its
  // own `processSyncQueue` call so freshly-unblocked entries land
  // without waiting for the next foreground tick.
  useAutoRetryOnUpgrade();
  // 09.6: route notification taps (cold-start + background) to their deep
  // link. Mounted in the authenticated tree so router targets resolve.
  useNotificationDeepLink();
  // Keep the OS app-icon badge in sync with the unread count (launch /
  // foreground / push).
  useNotificationBadge();
  // Cross-device weight sync: push new HealthKit weight/body-fat readings to
  // /measurements on launch + foreground (day-granularity dedup — see hook).
  // Complements useHealthWeightSync (YouContainer), which runs the OTHER
  // direction: coach-logged server rows → HealthKit.
  useHealthBodyPushSync();

  return (
    <ExerciseFiltersProvider>
      <Stack
        screenOptions={{
          // Opt-OUT of the native header by default. Every app screen renders
          // its own <HeaderBar>, so a default native header would double up
          // (the recurring "two headers" bug, e.g. /requests). Screens that
          // genuinely want the native header opt in with `headerShown: true`
          // (exercises/filters, sync-blocked, coming-soon below).
          headerShown: false,
          headerStyle: { backgroundColor: colorPalette.neutral1000 },
          headerTintColor: colorPalette.neutral0,
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: colorPalette.neutral1000 },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen
          name="profile/notifications"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="profile/edit" options={{ headerShown: false }} />
        <Stack.Screen name="profile/health" options={{ headerShown: false }} />
        <Stack.Screen name="profile/privacy" options={{ headerShown: false }} />
        <Stack.Screen
          name="profile/privacy-settings"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="profile/help" options={{ headerShown: false }} />
        <Stack.Screen name="profile/contact" options={{ headerShown: false }} />
        <Stack.Screen name="profile/terms" options={{ headerShown: false }} />
        <Stack.Screen
          name="exercises/[id]/index"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="clients/[id]/index"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="programs/create" options={{ headerShown: false }} />
        <Stack.Screen name="programs/[id]" options={{ headerShown: false }} />
        <Stack.Screen
          name="exercises/[id]/edit"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="exercises/create"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="exercises/filters"
          options={{
            title: "Filters",
            presentation: "modal",
            headerShown: true,
          }}
        />
        <Stack.Screen
          name="workouts/create"
          options={{
            title: "New workout",
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="workouts/[id]/index"
          options={{
            title: "Workout",
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="workouts/[id]/edit"
          options={{
            title: "Edit workout",
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="workouts/library"
          options={{ title: "Workout library", headerShown: false }}
        />
        <Stack.Screen
          name="session/index"
          options={{
            title: "Active session",
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="session/rate"
          options={{
            title: "Rate workout",
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="session/summary"
          options={{
            title: "Session summary",
            presentation: "modal",
            headerShown: false,
          }}
        />
        {/*
          M10.6 sync-blocked review screen. Pushes over the tabs (not
          modal) so the back affordance returns to the Home tab where
          the banner is mounted, preserving the user's mental thread.
        */}
        <Stack.Screen
          name="sync-blocked"
          options={{ title: "Blocked by your plan", headerShown: true }}
        />
        {/*
          Generic placeholder route. Renders no <HeaderBar> of its own, so it
          opts back into the native header for a back affordance.
        */}
        <Stack.Screen
          name="coming-soon"
          options={{ title: "Coming soon", headerShown: true }}
        />
        {/*
          fuel/recipes is still the M9-era stub — bare <ComingSoon> (no
          HeaderBar), so it opts into the native header for a back affordance
          until its real screen lands.
        */}
        <Stack.Screen
          name="fuel/recipes"
          options={{ title: "Recipes", headerShown: true }}
        />
        {/*
          fuel/targets (M9 PR3) owns its own <HeaderBar> (Cancel/Save) —
          native header off, matching every other custom-chrome screen.
        */}
        <Stack.Screen name="fuel/targets" options={{ headerShown: false }} />
      </Stack>
      {/*
        ProfileDrawerContainer is ALWAYS mounted (sibling of the Stack) — its
        internal <BottomSheet> uses the `visible` prop (sourced from
        useDrawer().open) to drive its own slide-in/out animation.
        Conditionally mounting on `open` would unmount the tree the instant
        the user dismisses, killing the slide-down exit. The avatar in every
        screen header opens it via useDrawer().openDrawer.

        Spec: specs/14-navigation/design.md § <ProfileDrawer> mount-point
              specs/14-navigation/tasks.md T-14.5.1
      */}
      <ProfileDrawerContainer />
      {/*
        ActiveWorkoutOverlay — the minimised "workout in progress" bar.
        Root-mounted so it persists across tab/drawer navigation. Renders the
        BAR only; the expanded session stays the /(app)/session modal route
        (Hybrid Option A — see the overlay's header for the rationale).

        Spec: specs/05-active-session/design.md § <ActiveWorkoutBarPresenter>
      */}
      <ActiveWorkoutOverlay />
      {/*
        AddClientSheetContainer — the coach invite-client bottom sheet
        (10-trainer-features). Root-mounted (sibling of the Stack) so it
        overlays the tab bar; its <BottomSheet> reads useAddClientSheet().open
        to drive the slide animation. The Coach You "Invite" button opens it.

        Spec: feedback_sheets_mount_at_root
      */}
      <AddClientSheetContainer />
      {/*
        AssignProgramSheet — the coach assign-programme-to-client bottom sheet
        (19-programs STORY-003). Root-mounted (sibling of the Stack) so it
        overlays the tab bar; reads useAssignProgramSheet().open to drive the
        slide animation. The Programs editor's "Assign to client" CTA opens it.

        Spec: feedback_sheets_mount_at_root
      */}
      <AssignProgramSheet />
      {/*
        AssignWorkoutSheet — ad-hoc single-workout assignment from Client Detail
        (19-programs STORY-006). Root-mounted sibling; reads
        useAssignWorkoutSheet().open.
      */}
      <AssignWorkoutSheet />
      {/*
        EditNutritionTargetsSheet + AssignGoalSheet — the M8 Coach Phase 5
        Client Detail quick-action sheets (Macros / Goals). Root-mounted
        siblings (feedback_sheets_mount_at_root); read their zustand open-state
        stores to drive the <BottomSheet> slide animation.
      */}
      <EditNutritionTargetsSheet />
      <AssignGoalSheet />
      {/*
        CoachNoteSheet — the M8 Coach Phase 12 add/edit/delete-note composer.
        Root-mounted sibling (feedback_sheets_mount_at_root); reads
        useCoachNoteSheet().open. Opened from Client Detail's Notes card.
      */}
      <CoachNoteSheet />
      {/*
        SendBriefSheet — the M17 coach "Send brief" composer. Root-mounted
        sibling (feedback_sheets_mount_at_root); reads useSendBriefSheet().open.
        Opened from Client Detail's Quick Actions (Brief).
      */}
      <SendBriefSheet />
      {/*
        SwapWorkoutSheet — the M18 coach "swap this workout" picker. Root-mounted
        sibling (feedback_sheets_mount_at_root); reads useSwapWorkoutSheet().open.
        Opened from a Client Detail Upcoming-sessions row.
      */}
      <SwapWorkoutSheet />
      {/*
        GoalSheet — the athlete's own add/edit-goal sheet (M16 — Athlete
        Training page). Root-mounted sibling (feedback_sheets_mount_at_root);
        reads useGoalSheet().open. Opened from the Train overview's Goals
        section (self-set goals only; coach-assigned goals are view-only).
      */}
      <GoalSheet />
      {/*
        M9 Fuel sheets — root-mounted siblings (feedback_sheets_mount_at_root).
        All three read useFuelSheets().sheet to drive their <BottomSheet>
        visibility; the Fuel screen's Scan / Snap / Search / slot-Add
        affordances open them. Always mounted so the slide-out animates on
        dismiss.

        Spec: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § Sheets (mounted at root)
              specs/13-nutrition-tracking/design.md § Revised 2026-07-03 › Mobile flow (SnapAISheet)
      */}
      <QuickAddSheetContainer />
      <ScanBarcodeSheetContainer />
      <SnapAISheetContainer />
    </ExerciseFiltersProvider>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "@tamagui/core";

import {
  isSetupSection,
  type CachedClientProfile,
  type SetupItem,
  type SetupSection,
} from "@/domain/models/coachClientProfiles";
import type { ProgramWorkoutEntry } from "@/domain/models/program";
import {
  SECTION_TITLE,
  firstName,
  itemsOf,
  welcomeText,
} from "@/domain/services/coachClientProfiles.service";
import { resolveProfileId } from "@/application/commands/coachClientProfiles.command";
import {
  setupResolver,
  type SetupFormValues,
} from "@/ui/forms/clientProfileForms";
import { firstMessage } from "@/shared/form";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  useClientProfile,
  useCoachClientActions,
} from "@/ui/hooks/useCoachClientProfiles";
import { TopBar } from "@/ui/presenters/coachClients/kit";
import {
  CheckinsBody,
  MealPlanBody,
  ProgrammeBody,
  ResourcesBody,
  SectionPage,
  StarterFormsBody,
  TargetsBody,
  WelcomeBody,
  checkinsSub,
} from "@/ui/presenters/coachClients/SetupSectionPresenters";
import { useSetupLibrary } from "./useSetupLibrary";

/** The grey line under each section page's title (canvas C11l–r). */
export function sectionSub(
  section: SetupSection,
  clientFirst: string,
  items: readonly SetupItem[],
  schedules: Parameters<typeof checkinsSub>[1],
  nextWorkout: string | null = null,
): string {
  switch (section) {
    case "starter_form":
      return `Your usual starter forms, sent together when ${clientFirst} accepts. Drag to reorder.`;
    case "repeating_form":
      return checkinsSub(items, schedules, clientFirst);
    case "programme":
      return nextWorkout
        ? `For ${clientFirst} only. ${clientFirst} sees ${nextWorkout} as Next; no start date.`
        : `For ${clientFirst} only. Workouts go in order with Next; no start date.`;
    case "nutrition_target":
      return `${clientFirst}'s meal plans and Fuel build toward these.`;
    case "meal_plan":
      return `A list of meal ideas toward ${clientFirst}'s target. Optional.`;
    case "resource":
      return `Shown on ${clientFirst}'s Coach tab when they accept.`;
    case "welcome_message":
      return `Sent from you the moment ${clientFirst} accepts.`;
  }
}

function firstWorkout(
  rows: readonly ProgramWorkoutEntry[] | undefined,
): string | null {
  if (!rows || rows.length === 0) return null;
  return [...rows].sort((a, b) => a.position - b.position)[0]!.name;
}

/**
 * C11l–r — one set-up section on its own page, as a react-hook-form over
 * the section's items. "Set up" (back) saves when something changed and the
 * section is valid; Cancel drops the changes. The page keeps the items it
 * opened with, so a refresh underneath never moves its baseline.
 */
export function SetupSectionContainer() {
  const params = useLocalSearchParams<{ profileId: string; section: string }>();
  const section = isSetupSection(params.section) ? params.section : null;
  const profile = useClientProfile(resolveProfileId(params.profileId ?? ""));
  const router = useRouter();
  if (!section || !profile.data) {
    return (
      <View flex={1} testID="section-missing">
        <TopBar
          backLabel="Set up"
          onBack={() => router.back()}
          testID="section-missing-bar"
        />
        <Text
          paddingHorizontal={20}
          fontFamily="$body"
          fontSize={14}
          color="$text3"
        >
          {profile.isRefreshing ? "Loading…" : "We couldn't find this section."}
        </Text>
      </View>
    );
  }
  return <SectionForm section={section} profile={profile.data} />;
}

function SectionForm(p: {
  section: SetupSection;
  profile: CachedClientProfile;
}) {
  const { section, profile } = p;
  const router = useRouter();
  const { api, storage } = useAdapters();
  const online = useOnlineStatus();
  const actions = useCoachClientActions();
  const lib = useSetupLibrary({
    plans: section === "meal_plan",
    resources: section === "resource",
  });
  const clientFirst = firstName(profile.displayName);

  const opened = useRef(itemsOf(profile, section));
  const openedRevision = useRef(profile.revision);
  const userId = useAuth().session?.userId ?? "";
  const form = useForm<SetupFormValues>({
    resolver: setupResolver,
    defaultValues: { section, items: opened.current },
  });
  const items = form.watch("items");
  const error = firstMessage(form.formState.errors) ?? null;

  // The programme page lists each chosen programme's workouts in order.
  const [workouts, setWorkouts] = useState<
    Record<string, readonly ProgramWorkoutEntry[]>
  >({});
  const refIds = useMemo(
    () => (section === "programme" ? items.map((i) => i.refId ?? "") : []),
    [items, section],
  );
  useEffect(() => {
    let live = true;
    for (const id of refIds) {
      if (!id || workouts[id]) continue;
      void api.getProgram(id).then((result) => {
        if (live && result.ok) {
          setWorkouts((w) => ({ ...w, [id]: result.value.workouts }));
        }
      });
    }
    return () => {
      live = false;
    };
  }, [api, refIds, workouts]);

  const onChange = (next: SetupItem[]) =>
    form.setValue("items", next, { shouldDirty: true });

  const onBack = form.handleSubmit((valid) => {
    // Only a real change is saved (formState.isDirty isn't subscribed here).
    if (JSON.stringify(valid.items) !== JSON.stringify(opened.current)) {
      const clean =
        valid.section === "welcome_message"
          ? valid.items
              .map((i) => ({
                ...i,
                config: { text: welcomeText(i).trim() },
              }))
              .filter((i) => i.config.text !== "")
          : valid.items;
      // Nobody else changed this section since the page opened: send the
      // revision the phone has now (this phone's own earlier writes moved
      // it on). Otherwise the one it opened on, so the server can say 409.
      const latest = storage.getCachedCoachClientProfile(userId, profile.id);
      const untouched =
        !!latest &&
        JSON.stringify(itemsOf(latest, section)) ===
          JSON.stringify(opened.current);
      actions.saveSection(
        profile.id,
        section,
        clean,
        untouched ? undefined : openedRevision.current,
      );
    }
    router.back();
  });

  const base = { items, onChange, clientFirst };
  const programmeName =
    lib.library.programmes.get(itemsOf(profile, "programme")[0]?.refId ?? "")
      ?.name ?? null;

  return (
    <SectionPage
      title={SECTION_TITLE[section]}
      sub={sectionSub(
        section,
        clientFirst,
        items,
        lib.library.schedules,
        firstWorkout(workouts[items[0]?.refId ?? ""]),
      )}
      backLabel="Set up"
      error={error}
      conflict={!!profile.conflictAt}
      onBack={() => void onBack()}
      onCancel={() => router.back()}
      onDismissConflict={() => actions.dismissProfileConflict(profile.id)}
      testID={`section-${section}`}
    >
      {section === "starter_form" ? (
        <StarterFormsBody
          {...base}
          forms={lib.forms}
          libraryLoading={lib.loading.forms}
        />
      ) : section === "repeating_form" ? (
        <CheckinsBody
          {...base}
          forms={lib.forms}
          schedules={lib.schedules}
          libraryLoading={lib.loading.schedules}
        />
      ) : section === "programme" ? (
        <ProgrammeBody
          {...base}
          programmes={lib.programmes}
          workouts={workouts}
          libraryLoading={lib.loading.programmes}
          offline={!online}
        />
      ) : section === "nutrition_target" ? (
        <TargetsBody {...base} />
      ) : section === "meal_plan" ? (
        <MealPlanBody
          {...base}
          plans={lib.plans}
          libraryLoading={lib.loading.plans && online}
          offline={!online || lib.failed.plans}
        />
      ) : section === "resource" ? (
        <ResourcesBody
          {...base}
          resources={lib.resources}
          libraryLoading={lib.loading.resources && online}
          offline={!online || lib.failed.resources}
        />
      ) : (
        <WelcomeBody {...base} programmeName={programmeName} />
      )}
    </SectionPage>
  );
}

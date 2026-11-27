import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  checklistSummary,
  firstName,
  formMeta,
  itemsOf,
  welcomeText,
} from "@/domain/services/coachClientProfiles.service";
import { resolveProfileId } from "@/application/commands/coachClientProfiles.command";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useClientProfile } from "@/ui/hooks/useCoachClientProfiles";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { ClientPreviewPresenter } from "@/ui/presenters/coachClients/ClientPreviewPresenter";
import { useSetupLibrary } from "./useSetupLibrary";

/**
 * C11s — Preview as the client, from the set-up on this phone (works
 * offline). The programme's first workout (Next) is read online when it can
 * be; otherwise the row shows the programme alone.
 */
export function ClientPreviewContainer() {
  const router = useRouter();
  const { api } = useAdapters();
  const params = useLocalSearchParams<{ profileId: string }>();
  const profile = useClientProfile(resolveProfileId(params.profileId ?? ""));
  const { library } = useSetupLibrary();
  const coachName =
    useProfilePage().payload?.profile.fullName?.trim() || "Your coach";
  const detail = profile.data;
  const programmeId = detail ? itemsOf(detail, "programme")[0]?.refId : null;
  const [nextWorkout, setNextWorkout] = useState<string | null>(null);

  useEffect(() => {
    if (!programmeId) return;
    let live = true;
    void api.getProgram(programmeId).then((result) => {
      if (!live || !result.ok) return;
      const first = [...result.value.workouts].sort(
        (a, b) => a.position - b.position,
      )[0];
      setNextWorkout(first?.name ?? null);
    });
    return () => {
      live = false;
    };
  }, [api, programmeId]);

  const close = () => router.back();
  if (!detail) {
    return (
      <ClientPreviewPresenter
        clientFirst="your client"
        coachName={coachName}
        programmeName={null}
        nextWorkout={null}
        welcome={null}
        forms={[]}
        targets={null}
        plans={[]}
        resources={0}
        onClose={close}
      />
    );
  }
  const programmeName = programmeId
    ? (library.programmes.get(programmeId)?.name ?? "Programme")
    : null;
  const targetItems = itemsOf(detail, "nutrition_target");
  return (
    <ClientPreviewPresenter
      clientFirst={firstName(detail.displayName)}
      coachName={coachName}
      programmeName={programmeName}
      nextWorkout={nextWorkout}
      welcome={
        welcomeText(itemsOf(detail, "welcome_message")[0]).trim() || null
      }
      forms={itemsOf(detail, "starter_form").map((item, i) => {
        const form = library.forms.get(item.refId ?? "");
        return {
          key: `${item.refId ?? i}`,
          title: form?.title ?? "Form",
          meta: formMeta(form),
        };
      })}
      targets={
        targetItems.length > 0
          ? checklistSummary("nutrition_target", targetItems, library, "")
          : null
      }
      plans={itemsOf(detail, "meal_plan").map(
        (i) => library.plans.get(i.refId ?? "")?.name ?? "Meal plan",
      )}
      resources={itemsOf(detail, "resource").length}
      onClose={close}
    />
  );
}

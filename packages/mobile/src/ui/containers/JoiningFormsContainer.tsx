import { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  HEALTH_SCREENING_COPY,
  type AthleteFormRequest,
} from "@/domain/models/athleteForms";
import { firstName } from "@/domain/models/myCoaching";
import {
  joinHeadline,
  joinSummary,
  joiningForms,
  sizeLine,
} from "@/domain/services/athleteForms.service";
import {
  useAthleteFormActions,
  useAthleteForms,
} from "@/ui/hooks/useAthleteForms";
import { JoiningFormsPresenter } from "@/ui/presenters/athleteForms/JoiningFormsPresenter";

/**
 * `/forms/joining?coachId=` — PER-130, canvas C10q: a coach's joining forms
 * in their order. Both buttons mark the page seen, so the Coach tab doesn't
 * open it by itself again; the forms wait there.
 */
export function JoiningFormsContainer() {
  const router = useRouter();
  const { coachId } = useLocalSearchParams<{ coachId: string }>();
  const forms = useAthleteForms();
  const actions = useAthleteFormActions();
  const live = useMemo(
    () => joiningForms(forms.requests, forms.locals, coachId ?? ""),
    [forms.requests, forms.locals, coachId],
  );
  // Hold the list while the page is open (a refresh mustn't empty it).
  const [list, setList] = useState<AthleteFormRequest[]>(live);
  useEffect(() => {
    if (live.length > 0) setList(live);
  }, [live]);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/coach");
  };

  if (list.length === 0) return null;
  const coachName = list[0]!.coach.name ?? "";
  const first = firstName(coachName) || "Your coach";

  return (
    <JoiningFormsPresenter
      coachFirstName={first}
      headline={joinHeadline(list.length)}
      summary={joinSummary(list)}
      rows={list.map((r) => ({
        requestId: r.id,
        title: r.title,
        detail: sizeLine(r.version.questions),
      }))}
      healthCopy={HEALTH_SCREENING_COPY}
      onLater={() => {
        actions.markIntroSeen(list);
        close();
      }}
      onStart={() => {
        actions.markIntroSeen(list);
        router.replace({
          pathname: "/(app)/forms/[id]",
          params: { id: list[0]!.id, then: "joining" },
        } as never);
      }}
    />
  );
}

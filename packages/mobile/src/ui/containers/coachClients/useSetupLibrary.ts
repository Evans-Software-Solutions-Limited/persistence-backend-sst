import { useMemo } from "react";

import {
  buildSetupLibrary,
  type SetupLibrary,
} from "@/domain/services/coachClientProfiles.service";
import {
  useCoachFormSchedules,
  useCoachFormsLibrary,
} from "@/ui/hooks/useCoachForms";
import { useGetPrograms } from "@/ui/hooks/useGetPrograms";
import {
  useSetupMealPlans,
  useSetupResources,
} from "@/ui/hooks/useCoachClientProfiles";

/**
 * The coach's library for the set-up rows' names and pickers: forms, send
 * rules and programmes from the phone's caches (offline too); meal plans and
 * resources read online.
 */
export function useSetupLibrary(
  opts: { plans?: boolean; resources?: boolean } = {},
) {
  const forms = useCoachFormsLibrary();
  const schedules = useCoachFormSchedules();
  const programmes = useGetPrograms();
  const plans = useSetupMealPlans({ enabled: opts.plans ?? true });
  const resources = useSetupResources({ enabled: opts.resources ?? true });

  const library: SetupLibrary = useMemo(
    () =>
      buildSetupLibrary({
        forms: forms.data?.forms,
        schedules: schedules.data,
        programmes: programmes.data,
        plans: plans.data,
        resources: resources.data,
      }),
    [forms.data, schedules.data, programmes.data, plans.data, resources.data],
  );

  return {
    library,
    forms: forms.data?.forms ?? [],
    schedules: schedules.data ?? [],
    programmes: programmes.data ?? [],
    plans: plans.data ?? [],
    resources: resources.data ?? [],
    loading: {
      forms: forms.data === null && forms.isRefreshing,
      schedules: schedules.data === null && schedules.isRefreshing,
      programmes: programmes.data === null && programmes.isRefreshing,
      plans: plans.data === null && plans.error === null,
      resources: resources.data === null && resources.error === null,
    },
    failed: {
      plans: plans.data === null && plans.error !== null,
      resources: resources.data === null && resources.error !== null,
    },
  };
}

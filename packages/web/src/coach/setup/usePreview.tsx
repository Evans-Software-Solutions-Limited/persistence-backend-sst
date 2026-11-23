import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ClientProfileDetail } from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useCoachProfile,
} from "../hooks/coachQueries";
import { firstName, initials } from "../lib/people";
import {
  formMeta,
  formatKcal,
  itemsOf,
  targetNumbers,
  type Library,
} from "../lib/setup";
import { PreviewPanel } from "./PreviewPanel";

/** "Preview as Lena" for any screen that holds a client profile. */
export function usePreview(
  detail: ClientProfileDetail | undefined,
  lib: Library,
) {
  const api = useCoachApi();
  const coach = useCoachProfile();
  const [open, setOpen] = useState(false);
  const id = detail?.id ?? "";
  const preview = useQuery({
    queryKey: coachKeys.preview(id),
    queryFn: () => api.preview(id),
    enabled: open && !!id,
    staleTime: 0,
    networkMode: COACH_NETWORK_MODE,
  });

  let panel = null;
  if (open && detail) {
    const coachName = coach.data?.fullName ?? "Your coach";
    const target = targetNumbers(itemsOf(detail, "nutrition_target")[0]);
    panel = (
      <PreviewPanel
        loading={preview.isPending}
        onClose={() => setOpen(false)}
        model={{
          clientFirstName: firstName(detail.displayName),
          coachName,
          coachInitials: initials(coachName),
          welcomeMessage: preview.data?.welcomeMessage ?? null,
          startForms: itemsOf(detail, "starter_form").map((i) => {
            const form = lib.forms.get(i.refId ?? "");
            return { title: form?.title ?? "Form", meta: formMeta(form) };
          }),
          plans: (preview.data?.plans ?? []).map((p) => p.name),
          targets: target
            ? `${formatKcal(target.dailyKcal)} kcal · ${formatKcal(target.proteinG)} g protein`
            : null,
        }}
      />
    );
  }
  return { open: () => setOpen(true), panel };
}

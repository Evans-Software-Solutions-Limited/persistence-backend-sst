import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  EMPTY_WHO,
  changedProfileFields,
  toProfileFields,
  whoResolver,
  whoValuesFrom,
  type WhoValues,
} from "@/ui/forms/clientProfileForms";
import { applyValues, fieldMessages } from "@/shared/form";
import {
  useClientProfile,
  useCoachClientActions,
} from "@/ui/hooks/useCoachClientProfiles";
import { resolveProfileId } from "@/application/commands/coachClientProfiles.command";
import { WhoStepPresenter } from "@/ui/presenters/coachClients/WhoStepPresenter";
import { coachClientRoutes, flowOf } from "./routes";

const WHO_KEYS = ["first", "last", "contact", "goal", "notes"] as const;

/**
 * C11f — Add client · 1 Who, on react-hook-form. A new client's profile is
 * made at once (offline too; shown as Invited) and the flow moves on to Set
 * up. Opened on an existing profile it edits it: in the add flow (Back from
 * Set up) Next goes on to Set up again; from the invited client it's Save.
 * Only the fields that changed are sent, against the revision the form
 * started from.
 */
export function AddClientWhoContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ profileId?: string; flow?: string }>();
  const profileId = params.profileId
    ? resolveProfileId(params.profileId)
    : null;
  const flow = profileId ? flowOf(params.flow) : "add";
  const profile = useClientProfile(profileId ?? "", { enabled: !!profileId });
  const actions = useCoachClientActions();
  const current = profileId ? profile.data : null;

  const form = useForm<WhoValues>({
    resolver: whoResolver,
    defaultValues: current ? whoValuesFrom(current) : EMPTY_WHO,
  });
  // The form keeps the copy it loaded, so a refresh never moves its baseline.
  const baseline = useRef(current);
  useEffect(() => {
    // First load, or the queue took another device's copy (a 409): start
    // again from what the server has.
    const conflictMoved =
      !!current?.conflictAt &&
      current.conflictAt !== baseline.current?.conflictAt;
    if (current && (!baseline.current || conflictMoved)) {
      baseline.current = current;
      form.reset(whoValuesFrom(current));
    }
  }, [current, form]);

  const values = form.watch();
  const errors = fieldMessages(form.formState.errors, WHO_KEYS);

  const onNext = form.handleSubmit((valid) => {
    const fields = toProfileFields(valid);
    if (!profileId) {
      const created = actions.createProfile(fields);
      if (created) router.replace(coachClientRoutes.setup(created.id, "add"));
      return;
    }
    const before = baseline.current ?? current;
    if (before) {
      const patch = changedProfileFields(before, fields);
      // The fields edited still read as they did when the form loaded: the
      // phone's revision now; otherwise the loaded one, so a change made on
      // another device meanwhile comes back as a 409, never overwritten.
      const untouched =
        !!current &&
        (Object.keys(patch) as (keyof typeof patch)[]).every(
          (k) => (current[k] ?? null) === (before[k] ?? null),
        );
      actions.updateProfile(
        profileId,
        patch,
        untouched ? undefined : before.revision,
      );
    }
    if (flow === "add")
      router.replace(coachClientRoutes.setup(profileId, "add"));
    else router.back();
  });

  return (
    <WhoStepPresenter
      mode={flow}
      title={
        flow === "add" ? "Add a client" : (current?.displayName ?? "Client")
      }
      backLabel={flow === "add" ? "Clients" : "Back"}
      values={values}
      errors={errors}
      conflict={!!current?.conflictAt}
      onChange={(next) => applyValues(form, next)}
      onNext={() => void onNext()}
      onBack={() => router.back()}
      onDismissConflict={() => {
        if (profileId) actions.dismissProfileConflict(profileId);
      }}
    />
  );
}

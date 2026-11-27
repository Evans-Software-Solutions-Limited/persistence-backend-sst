import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";

import type {
  CachedClientSettings,
  SettingsPatch,
} from "@/domain/models/coachClientProfiles";
import {
  applySettingsPatch,
  clampSessions,
  trainingPatch,
} from "@/domain/services/coachClientProfiles.service";
import {
  settingsResolver,
  settingsValues,
  type SettingsFormValues,
} from "@/ui/forms/clientProfileForms";
import { messageAt } from "@/shared/form";
import {
  useClientSettings,
  useCoachClientActions,
} from "@/ui/hooks/useCoachClientProfiles";
import { ClientSettingsPresenter } from "@/ui/presenters/coachClients/ClientSettingsPresenter";

/**
 * C3.9 — the client's Settings tab, as a react-hook-form. Each switch saves
 * on its own (offline too, through the queue with the revision the phone
 * has); the form checks the whole set first and only a valid change is
 * queued. A 409 from the queue shows the server's copy and says so.
 */
export function ClientSettingsContainer(p: {
  clientId: string;
  clientFirst: string;
  refreshKey?: number;
  ending: boolean;
  onEndCoaching: () => void;
}) {
  const settings = useClientSettings(p.clientId);
  const actions = useCoachClientActions();
  const data = settings.data;
  const form = useForm<SettingsFormValues>({
    resolver: settingsResolver,
    defaultValues: data ? settingsValues(data) : undefined,
  });

  // Follow the cache (a queued change, a refresh, a 409's server copy).
  const shown = useRef<CachedClientSettings | null>(null);
  useEffect(() => {
    if (data && data !== shown.current) {
      shown.current = data;
      form.reset(settingsValues(data));
    }
  }, [data, form]);

  const refresh = settings.refresh;
  const firstKey = useRef(p.refreshKey);
  useEffect(() => {
    if (p.refreshKey === firstKey.current) return;
    void refresh();
  }, [p.refreshKey, refresh]);

  const save = async (patch: SettingsPatch) => {
    if (!data) return;
    const next = settingsValues(applySettingsPatch(data, patch));
    for (const [key, value] of Object.entries(next)) {
      form.setValue(key as keyof SettingsFormValues, value as never, {
        shouldDirty: true,
      });
    }
    if (await form.trigger()) actions.patchSettings(p.clientId, patch);
  };

  const watched = form.watch();
  // Until the reset above has run, show the cache itself.
  const values = data
    ? watched.features
      ? watched
      : settingsValues(data)
    : null;

  return (
    <ClientSettingsPresenter
      clientFirst={p.clientFirst}
      values={values}
      error={messageAt(form.formState.errors, "sessionsPerWeek") ?? null}
      conflict={!!data?.conflictAt}
      loadFailed={settings.error !== null}
      ending={p.ending}
      onTraining={(on) => void save(trainingPatch(data!, on))}
      onCalories={(on) => void save({ trackCalories: on })}
      onSessions={(n) => void save({ sessionsPerWeek: clampSessions(n) })}
      onFeature={(key, on) => void save({ features: { [key]: on } })}
      onAlertMode={(mode) => void save({ alertMode: mode })}
      onEndCoaching={p.onEndCoaching}
      onDismissConflict={() => actions.dismissSettingsConflict(p.clientId)}
    />
  );
}

import { useCallback, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import {
  LogClientWeightPresenter,
  type LogClientWeightSaveInput,
} from "@/ui/presenters/LogClientWeightPresenter";

/**
 * <LogClientWeightContainer> — wires the coach log-weight form (weight +
 * optional body fat) to POST /clients/:clientId/measurements
 * (`api.logClientWeight`). Reads the client id (and optional name) from the
 * route params. On success it briefly shows "Logged ✓" then pops back to the
 * client detail.
 */
export function LogClientWeightContainer() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { api } = useAdapters();

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const onSave = useCallback(
    async ({ weightKg, bodyFatPercentage }: LogClientWeightSaveInput) => {
      if (!id) return;
      setSaving(true);
      setError(null);
      const result = await api.logClientWeight(id, {
        weightKg,
        ...(bodyFatPercentage != null ? { bodyFatPercentage } : {}),
      });
      setSaving(false);
      if (result.ok) {
        setSuccess(true);
        setTimeout(() => {
          if (router.canGoBack()) router.back();
        }, 800);
      } else {
        setError("Couldn't log the weight. Please try again.");
      }
    },
    [api, id, router],
  );

  return (
    <LogClientWeightPresenter
      clientName={name ?? null}
      saving={saving}
      success={success}
      error={error}
      onSave={onSave}
      onBack={onBack}
    />
  );
}

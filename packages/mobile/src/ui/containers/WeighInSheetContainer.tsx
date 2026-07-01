import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useLogMeasurement } from "@/ui/hooks/useLogMeasurement";
import { useGetBodyMeasurements } from "@/ui/hooks/useGetBodyMeasurements";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import {
  WeighInSheetPresenter,
  type WeighInSaveInput,
  type WeighInUnit,
} from "@/ui/presenters/WeighInSheetPresenter";

const KG_PER_LB = 0.45359237;

/**
 * Wires the weigh-in sheet to the offline-first measurement log
 * (06-progress-goals, STORY-005) + Apple Health (07-health-integration). Seeds
 * the sparkline from the cached body-trend and prefills weight/body-fat from
 * the latest Apple Health reading when the sheet opens; on save it logs +
 * queues the measurement AND writes weight + body fat back to Apple Health
 * (best-effort: the write is a no-op on platforms without HealthKit). The
 * kg/lb toggle defaults from the profile's `weightUnit` preference —
 * independent of `heightUnit` (Edit Profile), since users routinely mix
 * units (e.g. kg for weight, ft/in for height).
 */
export function WeighInSheetContainer({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { health } = useAdapters();
  const log = useLogMeasurement();
  const body = useGetBodyMeasurements(30);
  const profilePage = useProfilePage();
  const [saving, setSaving] = useState(false);
  const [prefillWeightKg, setPrefillWeightKg] = useState<number | undefined>();
  const [prefillBodyFat, setPrefillBodyFat] = useState<number | null>(null);

  // `undefined` until the profile resolves (cache-first, so this is often
  // synchronous) — the presenter only seeds its unit toggle once this stops
  // being `undefined`, so it never has to guess a wrong "kg" default.
  const defaultUnit: WeighInUnit | undefined = profilePage.payload
    ? profilePage.payload.profile.weightUnit
    : undefined;

  const history = useMemo(
    () =>
      (body.data ?? [])
        .map((p) => p.weightKg)
        .filter((w): w is number => w != null),
    [body.data],
  );

  // Prefill from the latest Apple Health reading when the sheet opens.
  // Best-effort: stub/Android adapters return `unavailable`, which we ignore
  // (the form falls back to the cached body-trend / a sensible default).
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      const [weight, fat] = await Promise.all([
        health.getLatestBodyWeight(),
        health.getLatestBodyFat(),
      ]);
      if (cancelled) return;
      if (weight.ok && weight.value) {
        const kg =
          weight.value.unit === "lbs"
            ? weight.value.value * KG_PER_LB
            : weight.value.value;
        setPrefillWeightKg(kg);
      }
      if (fat.ok) setPrefillBodyFat(fat.value?.value ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, health]);

  const onSave = useCallback(
    async (input: WeighInSaveInput) => {
      setSaving(true);
      const res = await log.mutate(
        {
          weightKg: input.weightKg,
          bodyFatPercentage: input.bodyFatPercentage ?? undefined,
        },
        input.day,
      );
      setSaving(false);
      // Only mirror into Apple Health once the offline-first log ACCEPTED the
      // values. logMeasurementCommand rejects empty/non-positive/over-999
      // weights, and an invalid HealthKit sample (e.g. a negative body mass) is
      // awkward for the user to delete from the Health app. On rejection we keep
      // the sheet open so the value can be corrected.
      if (!res.ok) return;
      // Anchor at local noon of the chosen day so the HealthKit sample lands on
      // the right calendar day. Fire-and-forget — a Health write failure must
      // not block the log that already succeeded.
      const when = new Date(`${input.day}T12:00:00`);
      void health.writeBodyWeight(input.weightKg, when);
      if (input.bodyFatPercentage != null) {
        void health.writeBodyFat(input.bodyFatPercentage, when);
      }
      onClose();
    },
    [log, health, onClose],
  );

  return (
    <WeighInSheetPresenter
      visible={visible}
      onClose={onClose}
      onSave={onSave}
      history={history}
      defaultUnit={defaultUnit}
      defaultWeightKg={prefillWeightKg}
      defaultBodyFat={prefillBodyFat}
      saving={saving}
    />
  );
}

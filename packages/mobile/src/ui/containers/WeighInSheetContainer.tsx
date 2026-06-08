import { useCallback, useMemo, useState } from "react";
import { useLogMeasurement } from "@/ui/hooks/useLogMeasurement";
import { useGetBodyMeasurements } from "@/ui/hooks/useGetBodyMeasurements";
import {
  WeighInSheetPresenter,
  type WeighInSaveInput,
} from "@/ui/presenters/WeighInSheetPresenter";

/**
 * Wires the weigh-in sheet to the offline-first measurement log
 * (06-progress-goals, STORY-005). Seeds the sparkline from the cached
 * body-trend; on save, optimistically logs + queues + closes.
 */
export function WeighInSheetContainer({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const log = useLogMeasurement();
  const body = useGetBodyMeasurements(30);
  const [saving, setSaving] = useState(false);

  const history = useMemo(
    () =>
      (body.data ?? [])
        .map((p) => p.weightKg)
        .filter((w): w is number => w != null),
    [body.data],
  );

  const onSave = useCallback(
    async (input: WeighInSaveInput) => {
      setSaving(true);
      const res = await log.mutate({ weightKg: input.weightKg }, input.day);
      setSaving(false);
      if (res.ok) onClose();
    },
    [log, onClose],
  );

  return (
    <WeighInSheetPresenter
      visible={visible}
      onClose={onClose}
      onSave={onSave}
      history={history}
      saving={saving}
    />
  );
}

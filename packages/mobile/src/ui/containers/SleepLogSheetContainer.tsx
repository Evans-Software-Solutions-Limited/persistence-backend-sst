import { useCallback, useEffect, useState } from "react";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useLogSleep } from "@/ui/hooks/useLogSleep";
import { localDayISO } from "@/shared/utils";
import {
  SleepLogSheetPresenter,
  type SleepSaveInput,
} from "@/ui/presenters/SleepLogSheetPresenter";

/** Sleep is logged against a fixed local wake-hour anchor (Decision D1/D2). */
const WAKE_HOUR_LOCAL = 7;

/**
 * Wires the Sleep quick-log sheet to the offline-first sleep log
 * (specs/20-sleep-quicklog STORY-001) + Apple Health (STORY-003). Prefills
 * the duration from HealthKit's last-night reading when the sheet opens; on
 * save it logs + queues the entry (sleepDate = today, Decision D2) AND
 * mirrors the synthesised sleepStart/sleepEnd window back to Apple Health
 * (best-effort — a HealthKit failure never fails the already-accepted save).
 * Mirrors <WeighInSheetContainer> 1:1.
 */
export function SleepLogSheetContainer({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { health } = useAdapters();
  const log = useLogSleep();
  const [saving, setSaving] = useState(false);
  const [prefillMinutes, setPrefillMinutes] = useState<number | undefined>();

  // Prefill from Apple Health when the sheet opens. Best-effort: stub/Android
  // adapters return `unavailable`, which we ignore (the sheet falls back to
  // its own default).
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      const result = await health.getSleepLastNight();
      if (cancelled) return;
      if (result.ok && result.value) {
        setPrefillMinutes(result.value.durationMinutes);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, health]);

  const onSave = useCallback(
    async (input: SleepSaveInput) => {
      setSaving(true);
      // Decision D2: sleepDate is the wake day (today, user-local).
      const sleepDate = localDayISO();
      // Decision D1: synthesise a HealthKit-style window — wake anchored at
      // 07:00 local on the wake day, start derived backward by the duration.
      // Built from explicit local components (Date(y, m, d, h, ...)) rather
      // than parsing a bare-local datetime STRING — the latter's parsing is
      // engine-dependent (unverified on Hermes; this repo pins zones
      // explicitly elsewhere, see shared/utils/date.ts).
      const [year, month, day] = sleepDate.split("-").map(Number);
      const end = new Date(year, month - 1, day, WAKE_HOUR_LOCAL, 0, 0, 0);
      const start = new Date(end.getTime() - input.durationMinutes * 60_000);

      const res = await log.mutate({
        sleepDate,
        durationMinutes: input.durationMinutes,
        sleepStart: start.toISOString(),
        sleepEnd: end.toISOString(),
      });
      setSaving(false);
      // Only mirror into Apple Health once the offline-first log ACCEPTED
      // the value (mirrors WeighInSheetContainer's posture) — an invalid
      // duration keeps the sheet open so it can be corrected, and never
      // reaches HealthKit.
      if (!res.ok) return;
      // Fire-and-forget — a Health write failure must never block or fail
      // the log that already succeeded. `.catch` swallows a rejection so it
      // never surfaces as an unhandled promise rejection.
      health.writeSleep(start, end).catch(() => {});
      onClose();
    },
    [log, health, onClose],
  );

  return (
    <SleepLogSheetPresenter
      visible={visible}
      onClose={onClose}
      onSave={onSave}
      defaultDurationMinutes={prefillMinutes}
      saving={saving}
    />
  );
}

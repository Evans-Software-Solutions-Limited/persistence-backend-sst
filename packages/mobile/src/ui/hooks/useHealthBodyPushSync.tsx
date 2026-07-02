import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { localDayISO } from "@/shared/utils/date";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/** How many recent measurements to scan per sync pass. */
const SCAN_LIMIT = 50;

const KG_PER_LB = 0.45359237;

/**
 * Pushes the latest HealthKit weight / body-fat readings to the server
 * (07-health-integration, cross-device weight sync).
 *
 * The gap this closes: a weight recorded OUTSIDE the app (connected scale →
 * Apple Health, or the Health app itself) never reached `/measurements`, so
 * the user's other devices — and their coach — never saw it. On app open +
 * foreground, this reads the latest HealthKit weight and body-fat samples and
 * POSTs any that are genuinely new.
 *
 * Dedup is by LOCAL CALENDAR DAY, strictly newer than the server's latest —
 * timestamp comparison would echo-loop, because both existing flows create
 * same-day pairs whose clock order is arbitrary:
 *
 *   - a self weigh-in mirrors into HealthKit anchored at local NOON of the
 *     chosen day, while the server row is stamped at request time
 *     (`WeighInSheetContainer.onSave`) — noon can be "after" the server row;
 *   - a coach-logged weight is written into HealthKit dated at the server
 *     row's own `measuredAt` (`useHealthWeightSync`).
 *
 * Day-granularity also matches the trend semantics everywhere else (the
 * body-trend series and `logMeasurementCommand`'s optimistic cache are both
 * day-bucketed). The trade-off — a second same-day scale reading waits for
 * the next day's pass — is deliberate.
 *
 * Fetch-before-push: the pass starts by reading the server's recent
 * measurements and SKIPS entirely when that read fails. A fresh install (or
 * an offline launch) therefore can't blind-post HealthKit history the server
 * already has from another device. No local cursor is needed: a successful
 * POST makes the pushed row the server's latest, which blocks re-push on the
 * next pass.
 *
 * Runs on mount and app-foreground transitions; no-op when HealthKit is
 * unavailable or the body-weight permission isn't granted.
 */
export function useHealthBodyPushSync(): void {
  const { api, health } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const runningRef = useRef(false);

  const sync = useCallback(async () => {
    if (userId === null || runningRef.current) return;
    runningRef.current = true;
    try {
      if (!(await health.isAvailable())) return;
      const perms = await health.getPermissionStatus();
      if (perms.bodyWeight !== "granted") return;

      const [weightRes, fatRes] = await Promise.all([
        health.getLatestBodyWeight(),
        health.getLatestBodyFat(),
      ]);
      const weight = weightRes.ok ? weightRes.value : null;
      const fat = fatRes.ok ? fatRes.value : null;
      if (weight == null && fat == null) return;

      const server = await api.getMeasurements({ limit: SCAN_LIMIT });
      if (!server.ok) return;

      // Latest server day carrying each field (rows arrive newest-first, but
      // scan the lot — a girth-only row can sit above the last weigh-in).
      let lastWeightDay: string | null = null;
      let lastFatDay: string | null = null;
      for (const m of server.value) {
        if (m.measuredAt == null) continue;
        const day = localDayISO(new Date(m.measuredAt));
        if (
          m.weightKg != null &&
          (lastWeightDay == null || day > lastWeightDay)
        ) {
          lastWeightDay = day;
        }
        if (
          m.bodyFatPercentage != null &&
          (lastFatDay == null || day > lastFatDay)
        ) {
          lastFatDay = day;
        }
      }

      const today = localDayISO();
      const isPushableDay = (day: string, lastDay: string | null) =>
        day <= today && (lastDay == null || day > lastDay);

      // A candidate = a sane HealthKit value on a strictly-newer (and not
      // future-dated) local day. Sanity bounds mirror logMeasurementCommand.
      type Candidate = { value: number; day: string; date: string };

      let weightCandidate: Candidate | null = null;
      if (weight != null) {
        const kg =
          weight.unit === "lbs" ? weight.value * KG_PER_LB : weight.value;
        const day = localDayISO(new Date(weight.date));
        if (kg > 0 && kg <= 999 && isPushableDay(day, lastWeightDay)) {
          weightCandidate = { value: kg, day, date: weight.date };
        }
      }

      let fatCandidate: Candidate | null = null;
      if (fat != null) {
        const day = localDayISO(new Date(fat.date));
        if (
          fat.value > 0 &&
          fat.value < 100 &&
          isPushableDay(day, lastFatDay)
        ) {
          fatCandidate = { value: fat.value, day, date: fat.date };
        }
      }

      if (
        weightCandidate != null &&
        fatCandidate != null &&
        weightCandidate.day === fatCandidate.day
      ) {
        // Same-day pair (the connected-scale case) → one measurement row.
        const measuredAt =
          new Date(weightCandidate.date).getTime() >=
          new Date(fatCandidate.date).getTime()
            ? weightCandidate.date
            : fatCandidate.date;
        await api.logMeasurement({
          weightKg: weightCandidate.value,
          bodyFatPercentage: fatCandidate.value,
          measuredAt,
        });
        return;
      }
      if (weightCandidate != null) {
        await api.logMeasurement({
          weightKg: weightCandidate.value,
          measuredAt: weightCandidate.date,
        });
      }
      if (fatCandidate != null) {
        await api.logMeasurement({
          bodyFatPercentage: fatCandidate.value,
          measuredAt: fatCandidate.date,
        });
      }
      // POST failures are intentionally swallowed — the next mount/foreground
      // pass re-reads the server and retries anything still missing.
    } finally {
      runningRef.current = false;
    }
  }, [api, health, userId]);

  useEffect(() => {
    void sync();
  }, [sync]);

  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status === "active") void sync();
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [sync]);
}

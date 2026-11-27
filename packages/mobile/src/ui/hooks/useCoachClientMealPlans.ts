import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CoachCalorieAdherence,
  CoachClientMealPlans,
} from "@/domain/models/coachMealPlans";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";

export type CoachClientMealPlansState = {
  data: CoachClientMealPlans | null;
  calories: CoachCalorieAdherence | null;
  isLoading: boolean;
  error: ApiError | null;
  /** When the plans were last read, for the offline "as of" line. */
  readAt: number | null;
  reload: () => Promise<void>;
};

/**
 * PER-135 (C3.2b): one client's meal plans from this coach, their usage and
 * the client's own target, plus calorie adherence (PER-114) when tracked.
 * Read online; the last read stays on screen when the phone goes offline.
 */
export function useCoachClientMealPlans(
  clientId: string,
  enabled = true,
): CoachClientMealPlansState {
  const { api } = useAdapters();
  const [data, setData] = useState<CoachClientMealPlans | null>(null);
  const [calories, setCalories] = useState<CoachCalorieAdherence | null>(null);
  const [isLoading, setLoading] = useState(enabled);
  const [error, setError] = useState<ApiError | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const [plans, adherence] = await Promise.all([
      api.getCoachClientMealPlans(clientId),
      api.getCoachClientCalorieAdherence(clientId),
    ]);
    if (!alive.current) return;
    if (plans.ok) {
      setData(plans.value);
      setError(null);
      setReadAt(Date.now());
    } else {
      setError(plans.error);
    }
    if (adherence.ok) setCalories(adherence.value);
    setLoading(false);
  }, [api, clientId, enabled]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { data, calories, isLoading, error, readAt, reload };
}

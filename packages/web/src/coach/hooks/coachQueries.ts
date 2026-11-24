import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { coachApi, type CoachApi } from "../api/coachApi";

/**
 * Data access for the coach workspace. Containers read the API through this
 * context so tests can hand in a fake; presenters never see it.
 */
export const CoachApiContext = createContext<CoachApi>(coachApi);

export function useCoachApi(): CoachApi {
  return useContext(CoachApiContext);
}

/**
 * Run coach queries even when the browser says it's offline: the request then
 * fails as offline and the screen says so, instead of React Query pausing it
 * and showing "Loading…" for ever. Data already loaded stays on screen.
 */
export const COACH_NETWORK_MODE = "always" as const;

export const coachKeys = {
  all: ["coach"] as const,
  profile: ["coach", "profile"] as const,
  roster: ["coach", "roster"] as const,
  clientProfile: (id: string) => ["coach", "client-profile", id] as const,
  preview: (id: string) => ["coach", "preview", id] as const,
  forms: ["coach", "forms"] as const,
  schedules: ["coach", "form-schedules"] as const,
  mealPlans: ["coach", "meal-plans"] as const,
  formStats: ["coach", "form-stats"] as const,
  templates: ["coach", "form-templates"] as const,
  clientForms: (clientId: string) =>
    ["coach", "client-forms", clientId] as const,
  responses: (clientId: string) => ["coach", "responses", clientId] as const,
  settings: (clientId: string) => ["coach", "settings", clientId] as const,
  declaration: ["coach", "declaration"] as const,
};

/** `navigator.onLine`, kept live by the browser's online/offline events. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function useCoachProfile() {
  const api = useCoachApi();
  return useQuery({
    queryKey: coachKeys.profile,
    queryFn: () => api.profile(),
    networkMode: COACH_NETWORK_MODE,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useRoster() {
  const api = useCoachApi();
  return useQuery({
    queryKey: coachKeys.roster,
    queryFn: () => api.roster(),
    networkMode: COACH_NETWORK_MODE,
  });
}

export function useClientProfile(id: string | undefined) {
  const api = useCoachApi();
  return useQuery({
    queryKey: coachKeys.clientProfile(id ?? ""),
    queryFn: () => api.profileDetail(id!),
    enabled: !!id,
    networkMode: COACH_NETWORK_MODE,
  });
}

/** The coach's library: forms, send rules and meal plans. */
export function useLibrary() {
  const api = useCoachApi();
  const forms = useQuery({
    queryKey: coachKeys.forms,
    queryFn: () => api.forms(),
    staleTime: 60_000,
    networkMode: COACH_NETWORK_MODE,
  });
  const schedules = useQuery({
    queryKey: coachKeys.schedules,
    queryFn: () => api.formSchedules(),
    staleTime: 60_000,
    networkMode: COACH_NETWORK_MODE,
  });
  const plans = useQuery({
    queryKey: coachKeys.mealPlans,
    queryFn: () => api.mealPlans(),
    staleTime: 60_000,
    networkMode: COACH_NETWORK_MODE,
  });
  return {
    forms: forms.data,
    schedules: schedules.data,
    plans: plans.data,
  };
}

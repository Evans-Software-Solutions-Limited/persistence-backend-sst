import type { CoachScope } from "../relationships/resolveCoachScope";
import {
  AdherenceRepository,
  type AdherenceWindow,
} from "./adherenceRepository";
import {
  adherenceByArea,
  computeAdherence,
  practiceAdherence,
  type AdherenceByArea,
  type AdherenceReport,
  type CalorieAdherence,
  type PracticeAdherence,
  type TrainingAdherence,
} from "./computeAdherence";

/**
 * The coach-side consumers of the one adherence calculation (PER-114, design
 * B D3). Each assembles input with `AdherenceRepository` and runs
 * `computeAdherence`, so the adherence route, roster, client detail and
 * overview always agree.
 */

/** The full report for one client (GET …/:clientId/adherence, detail). */
export async function clientAdherenceReport(
  scope: CoachScope,
  window: AdherenceWindow,
  now: Date = new Date(),
): Promise<AdherenceReport> {
  const input = await new AdherenceRepository().loadForScope(
    scope,
    window,
    now,
  );
  return computeAdherence(input);
}

/** 7-day reports for the caller's active clients, keyed by client id. */
async function trainerReports(
  trainerId: string,
  clientIds: string[] | undefined,
  now: Date,
): Promise<Map<string, AdherenceReport>> {
  const repo = new AdherenceRepository();
  const subjects = await repo.subjectsForTrainer(trainerId, clientIds);
  const inputs = await repo.loadMany(subjects, "7d", now);
  const out = new Map<string, AdherenceReport>();
  for (const s of subjects) {
    out.set(s.clientId, computeAdherence(inputs.get(s.relationshipId)!));
  }
  return out;
}

/**
 * Roster `adherenceByArea` per client id. Only ACTIVE clients get an entry;
 * a pending client (no active relationship) is absent and the roster shows
 * `null` for it.
 */
export async function rosterAdherenceByArea(
  trainerId: string,
  clientIds: string[],
  now: Date = new Date(),
): Promise<Map<string, AdherenceByArea>> {
  const reports = await trainerReports(trainerId, clientIds, now);
  const out = new Map<string, AdherenceByArea>();
  for (const [clientId, report] of reports) {
    out.set(clientId, adherenceByArea(report));
  }
  return out;
}

/** Overview `adherenceByArea`: practice level over every active client. */
export async function overviewAdherenceByArea(
  trainerId: string,
  now: Date = new Date(),
): Promise<PracticeAdherence> {
  const reports = await trainerReports(trainerId, undefined, now);
  return practiceAdherence([...reports.values()]);
}

/**
 * Client detail `last7Days` (design B D3). `checkIn`, `forms` and `expected`
 * are filled by design C (PER-116/117); until then they're null / empty.
 */
export interface Last7Days {
  training: TrainingAdherence | null;
  calories: CalorieAdherence | null;
  checkIn: null;
  forms: null;
  expected: never[];
}

export function last7Days(report: AdherenceReport): Last7Days {
  return {
    training: report.training ?? null,
    calories: report.calories ?? null,
    checkIn: null,
    forms: null,
    expected: [],
  };
}

import type { CoachOverview } from "@/domain/models/coachOverview";

/** A representative, fully-populated Coach You overview for presenter tests. */
export function makeCoachOverview(
  overrides: Partial<CoachOverview> = {},
): CoachOverview {
  return {
    trainer: {
      name: "Bradley Evans",
      initials: "BE",
      coachSince: "2024-02-15T00:00:00.000Z",
    },
    businessStats: {
      activeClients: 8,
      newClientsThisMonth: 2,
      slotsTotal: 10,
      slotsOpen: 2,
      avgAdherence: 82,
      adherenceDelta: 4,
      clientPRsThisMonth: 14,
      clientsWithPRs: 6,
      retentionPct: 94,
      churnThisQuarter: 1,
    },
    clientHealthBreakdown: [
      { band: "strong", count: 4 },
      { band: "wobbling", count: 2 },
      { band: "atRisk", count: 2 },
    ],
    programStats: {
      activeProgramsCount: 3,
      programs: [
        { id: "p1", name: "Strength Foundations", activeClients: 5 },
        { id: "p2", name: "Hypertrophy 8wk", activeClients: 3 },
        { id: "p3", name: "Mobility Reset", activeClients: 1 },
      ],
    },
    recentActivity: [
      {
        type: "pr_achieved",
        clientId: "c1",
        clientName: "Priya Shah",
        clientInitials: "PS",
        payload: { recordType: "1rm", value: "100" },
        occurredAt: "2026-06-21T08:45:00.000Z",
      },
      {
        type: "session_completed",
        clientId: "c2",
        clientName: "Emma Chen",
        clientInitials: "EC",
        payload: { sessionName: "Wk 4 / Strength" },
        occurredAt: "2026-06-21T07:00:00.000Z",
      },
      {
        type: "missed_day",
        clientId: "c3",
        clientName: "Tom Hayward",
        clientInitials: "TH",
        payload: { dueDate: "2026-06-20", status: "skipped" },
        occurredAt: "2026-06-20T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

/** An empty/null-heavy overview (new trainer, no assignments, no tier limit). */
export function makeEmptyCoachOverview(): CoachOverview {
  return makeCoachOverview({
    businessStats: {
      activeClients: 0,
      newClientsThisMonth: 0,
      slotsTotal: null,
      slotsOpen: null,
      avgAdherence: null,
      adherenceDelta: null,
      clientPRsThisMonth: 0,
      clientsWithPRs: 0,
      retentionPct: null,
      churnThisQuarter: 0,
    },
    clientHealthBreakdown: [
      { band: "strong", count: 0 },
      { band: "wobbling", count: 0 },
      { band: "atRisk", count: 0 },
    ],
    programStats: { activeProgramsCount: 0, programs: [] },
    recentActivity: [],
  });
}

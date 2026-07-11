import type { TrainerClient } from "@/domain/models/trainerClient";

/**
 * A representative roster for presenter / container tests. Pre-sorted by
 * adherence ascending (null last) the way the backend returns it. Covers every
 * band, a NEW PR flag, a MISSED flag, a null-programLabel (always, in v1), a
 * null-adherence client, and a pending-status client.
 */
export function makeTrainerClients(
  overrides?: Partial<TrainerClient>[],
): TrainerClient[] {
  const base: TrainerClient[] = [
    {
      id: "c-tom",
      name: "Tom Hayward",
      initials: "TH",
      avatarUrl: null,
      status: "active",
      programLabel: null,
      programEndDate: null,
      adherence: 38,
      band: "crisis",
      lastSeenAt: "2026-06-18T08:00:00.000Z",
      flags: [{ tone: "error", label: "4d IDLE" }],
    },
    {
      id: "c-marcus",
      name: "Marcus Reid",
      initials: "MR",
      avatarUrl: null,
      status: "active",
      programLabel: null,
      programEndDate: null,
      adherence: 64,
      band: "atRisk",
      lastSeenAt: "2026-06-21T08:00:00.000Z",
      flags: [{ tone: "ember", label: "2 MISSED" }],
    },
    {
      id: "c-jonas",
      name: "Jonas Berg",
      initials: "JB",
      avatarUrl: null,
      status: "active",
      programLabel: null,
      programEndDate: null,
      adherence: 78,
      band: "wobbling",
      lastSeenAt: "2026-06-21T08:00:00.000Z",
      flags: [],
    },
    {
      id: "c-aisha",
      name: "Aisha Williams",
      initials: "AW",
      avatarUrl: null,
      status: "active",
      programLabel: null,
      programEndDate: null,
      adherence: 88,
      band: "strong",
      lastSeenAt: "2026-06-22T02:00:00.000Z",
      flags: [],
    },
    {
      id: "c-priya",
      name: "Priya Shah",
      initials: "PS",
      avatarUrl: null,
      status: "active",
      programLabel: null,
      programEndDate: null,
      adherence: 100,
      band: "stellar",
      lastSeenAt: "2026-06-22T08:45:00.000Z",
      flags: [{ tone: "gold", label: "NEW PR" }],
    },
    {
      id: "c-noah",
      name: "Noah Pending",
      initials: "NP",
      avatarUrl: null,
      status: "pending",
      programLabel: null,
      programEndDate: null,
      adherence: null,
      band: null,
      lastSeenAt: null,
      flags: [],
    },
  ];
  if (!overrides) return base;
  return base.map((c, i) => ({ ...c, ...(overrides[i] ?? {}) }));
}

/** A clock just after the latest fixture timestamp, for deterministic "ago". */
export const FIXED_NOW = new Date("2026-06-22T09:00:00.000Z").getTime();

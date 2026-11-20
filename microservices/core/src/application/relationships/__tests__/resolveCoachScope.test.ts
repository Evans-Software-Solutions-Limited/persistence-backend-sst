/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * resolveCoachScope (PER-108, design A D2). The happy paths and the
 * several-coaches isolation run against PGlite in
 * coaching/__tests__/coaching.integration.test.ts; this covers the two
 * branches a real database can't stage on demand.
 */

const verdict = vi.fn();
vi.mock("../assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: (...args: unknown[]) => verdict(...args),
}));

const relRows = vi.fn();
vi.mock("@persistence/db/client", () => ({
  getDb: () => {
    const chain: any = {};
    for (const m of ["select", "from", "where"]) chain[m] = () => chain;
    chain.limit = async () => relRows();
    return chain;
  },
}));

const find = vi.fn(async () => null);
vi.mock("../../coaching/clientSettings", async (original) => ({
  ...(await original<object>()),
  CoachClientSettingsRepository: class {
    find = find;
  },
}));

import { resolveCoachScope } from "../resolveCoachScope";

describe("resolveCoachScope", () => {
  beforeEach(() => {
    verdict.mockReset();
    relRows.mockReset();
    find.mockClear();
  });

  it("passes the gate's deny straight through, reading nothing else", async () => {
    const deny = {
      allowed: false,
      reason: "wrong_role",
      status: 403,
      body: { code: "not_a_trainer", message: "x" },
    };
    verdict.mockResolvedValue(deny);
    expect(await resolveCoachScope("t", "c")).toBe(deny);
    expect(relRows).not.toHaveBeenCalled();
  });

  it("denies when the relationship ended between the gate and the read", async () => {
    verdict.mockResolvedValue({ allowed: true });
    relRows.mockResolvedValue([]);
    expect(await resolveCoachScope("t", "c")).toMatchObject({
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client" },
    });
    expect(find).not.toHaveBeenCalled();
  });

  it("returns default settings when the coach has none stored", async () => {
    verdict.mockResolvedValue({ allowed: true });
    relRows.mockResolvedValue([{ id: "rel-1", activatedAt: null }]);
    const result = await resolveCoachScope("t", "c");
    expect(result).toMatchObject({
      allowed: true,
      scope: {
        relationshipId: "rel-1",
        activatedAt: null,
        settings: { trackTraining: false, alertMode: "default", revision: 1 },
      },
    });
    expect(find).toHaveBeenCalledWith("t", "rel-1");
  });
});

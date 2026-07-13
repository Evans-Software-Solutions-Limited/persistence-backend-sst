/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { hasActiveRelationship } from "../activeRelationshipGuard";

const dialect = new PgDialect();
function renderWhere(cond: unknown): string {
  return dialect.sqlToQuery(cond as SQL).sql;
}

describe("hasActiveRelationship", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when an active, non-AI relationship row is found (client not soft-deleted)", async () => {
    const where = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([{ id: "rel-1" }]),
    });
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    (getDb as any).mockReturnValue({ select: vi.fn(() => ({ from })) });

    expect(await hasActiveRelationship("t1", "c1")).toBe(true);
  });

  it("returns false when no row matches", async () => {
    const where = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    });
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    (getDb as any).mockReturnValue({ select: vi.fn(() => ({ from })) });

    expect(await hasActiveRelationship("t1", "c1")).toBe(false);
  });

  it("filters on profiles.deleted_at IS NULL (Cluster 2a — a soft-deleted client can't be newly assigned to)", async () => {
    let capturedWhere: unknown;
    const where = vi.fn((cond: unknown) => {
      capturedWhere = cond;
      return { limit: vi.fn().mockResolvedValue([]) };
    });
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    (getDb as any).mockReturnValue({ select: vi.fn(() => ({ from })) });

    await hasActiveRelationship("t1", "c1");

    expect(renderWhere(capturedWhere)).toContain('"deleted_at" is null');
  });
});

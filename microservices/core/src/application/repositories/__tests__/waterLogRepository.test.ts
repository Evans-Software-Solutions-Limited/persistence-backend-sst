/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import { WaterLogRepository } from "../waterLogRepository";

function selectChain(resolved: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolved),
      }),
    }),
  };
}

function insertChain(spy: ReturnType<typeof vi.fn>) {
  return {
    values: spy.mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

describe("WaterLogRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getCups returns the logged count", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain([{ cups: 5 }])),
    });
    expect(await new WaterLogRepository().getCups("u1", "2026-06-21")).toBe(5);
  });

  it("getCups returns 0 when nothing logged", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain([])),
    });
    expect(await new WaterLogRepository().getCups("u1", "2026-06-21")).toBe(0);
  });

  it("setCups clamps negatives to 0 and truncates", async () => {
    const valuesSpy = vi.fn();
    (getDb as any).mockReturnValue({
      insert: vi.fn().mockReturnValue(insertChain(valuesSpy)),
    });
    const out = await new WaterLogRepository().setCups("u1", "2026-06-21", -3);
    expect(out).toBe(0);
    expect(valuesSpy.mock.calls[0][0].cups).toBe(0);
  });

  it("adjust reads current then sets the sum", async () => {
    const valuesSpy = vi.fn();
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain([{ cups: 2 }])),
      insert: vi.fn().mockReturnValue(insertChain(valuesSpy)),
    });
    const out = await new WaterLogRepository().adjust("u1", "2026-06-21", 1);
    expect(out).toBe(3);
    expect(valuesSpy.mock.calls[0][0].cups).toBe(3);
  });
});

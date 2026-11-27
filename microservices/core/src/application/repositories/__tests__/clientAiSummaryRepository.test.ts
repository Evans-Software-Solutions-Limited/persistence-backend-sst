/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import {
  AI_COACH_SUMMARY_DAILY_LIMIT,
  AI_COACH_SUMMARY_ENDPOINT,
  ClientAiSummaryRepository,
} from "../clientAiSummaryRepository";

const AREAS = [
  { area: "training" as const, status: "good" as const, text: "3 of 4." },
];

describe("ClientAiSummaryRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes the shared endpoint key + a fail-safe positive daily limit", () => {
    expect(AI_COACH_SUMMARY_ENDPOINT).toBe(
      "/trainers/me/clients/:clientId/ai-summary",
    );
    // No env override in the test env → the default backstop, never NaN/0.
    expect(Number.isFinite(AI_COACH_SUMMARY_DAILY_LIMIT)).toBe(true);
    expect(AI_COACH_SUMMARY_DAILY_LIMIT).toBeGreaterThan(0);
  });

  it("getForDay returns the mapped row (ISO generatedAt) scoped to trainer/client/day", async () => {
    const generatedAt = new Date("2026-07-08T06:00:00.000Z");
    const limit = vi.fn().mockResolvedValue([
      {
        id: "sum-1",
        summary: "Solid week.",
        model: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
        refreshCount: 0,
        generatedAt,
      },
    ]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    (getDb as any).mockReturnValue({ select });

    const repo = new ClientAiSummaryRepository();
    const row = await repo.getForDay("trainer-1", "client-1", "2026-07-07");

    expect(row).toEqual({
      id: "sum-1",
      summary: "Solid week.",
      model: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
      refreshCount: 0,
      generatedAt: "2026-07-08T06:00:00.000Z",
      // A row cached before PER-115 has no summary by area.
      headline: null,
      areas: null,
      ask: null,
      weekOfProgramme: null,
    });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("getForDay returns the summary by area when the row has it (PER-115)", async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        id: "sum-3",
        summary: "Solid week. 3 of 4.",
        model: "m",
        refreshCount: 0,
        generatedAt: new Date("2026-07-08T06:00:00.000Z"),
        headline: "Solid week.",
        areas: AREAS,
        ask: "Ask about sleep.",
        weekOfProgramme: { week: 3, of: 8 },
      },
    ]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    (getDb as any).mockReturnValue({ select: () => ({ from }) });

    const row = await new ClientAiSummaryRepository().getForDay(
      "trainer-1",
      "client-1",
      "2026-07-07",
    );
    expect(row?.headline).toBe("Solid week.");
    expect(row?.areas).toEqual(AREAS);
    expect(row?.ask).toBe("Ask about sleep.");
    expect(row?.weekOfProgramme).toEqual({ week: 3, of: 8 });
  });

  it("getForDay returns null when no row exists for the day", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    (getDb as any).mockReturnValue({ select });

    const repo = new ClientAiSummaryRepository();
    expect(
      await repo.getForDay("trainer-1", "client-1", "2026-07-07"),
    ).toBeNull();
  });

  it("getForDay coerces a string generatedAt (driver returning text) to ISO string", async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        id: "sum-2",
        summary: "x",
        model: "m",
        refreshCount: 1,
        generatedAt: "2026-07-08T06:00:00.000Z",
      },
    ]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    (getDb as any).mockReturnValue({ select: () => ({ from }) });

    const repo = new ClientAiSummaryRepository();
    const row = await repo.getForDay("trainer-1", "client-1", "2026-07-07");
    expect(row?.generatedAt).toBe("2026-07-08T06:00:00.000Z");
    expect(row?.refreshCount).toBe(1);
  });

  it("insertInitial inserts a fresh row (refresh_count 0) → returns true when it wrote", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "sum-new" }]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    (getDb as any).mockReturnValue({ insert });

    const repo = new ClientAiSummaryRepository();
    const wrote = await repo.insertInitial({
      trainerId: "trainer-1",
      clientId: "client-1",
      coversDate: "2026-07-07",
      summary: "Auto summary.",
      model: "model-x",
      headline: "Solid week.",
      areas: AREAS,
      ask: "Ask about sleep.",
      weekOfProgramme: { week: 3, of: 8 },
    });

    expect(wrote).toBe(true);
    expect(values).toHaveBeenCalledWith({
      trainerId: "trainer-1",
      clientId: "client-1",
      coversDate: "2026-07-07",
      summary: "Auto summary.",
      model: "model-x",
      headline: "Solid week.",
      areas: AREAS,
      ask: "Ask about sleep.",
      weekOfProgramme: { week: 3, of: 8 },
      refreshCount: 0,
    });
    // Conflict-tolerant on the once-a-day key (concurrent-open race backstop).
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it("insertInitial returns false when a concurrent open already wrote the row (conflict no-op)", async () => {
    const returning = vi.fn().mockResolvedValue([]); // onConflictDoNothing → 0 rows
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    (getDb as any).mockReturnValue({ insert });

    const repo = new ClientAiSummaryRepository();
    const wrote = await repo.insertInitial({
      trainerId: "trainer-1",
      clientId: "client-1",
      coversDate: "2026-07-07",
      summary: "Auto summary.",
      model: "model-x",
      headline: "Solid week.",
      areas: AREAS,
      ask: "Ask about sleep.",
      weekOfProgramme: { week: 3, of: 8 },
    });
    expect(wrote).toBe(false);
  });

  it("updateRefresh overwrites the day's row, bumps refresh_count to 1, restamps generated_at", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    (getDb as any).mockReturnValue({ update });

    const repo = new ClientAiSummaryRepository();
    await repo.updateRefresh({
      trainerId: "trainer-1",
      clientId: "client-1",
      coversDate: "2026-07-07",
      summary: "Refreshed summary.",
      model: "model-x",
      headline: "Solid week.",
      areas: AREAS,
      ask: "Ask about sleep.",
      weekOfProgramme: { week: 3, of: 8 },
    });

    expect(update).toHaveBeenCalledTimes(1);
    const setArg = set.mock.calls[0][0];
    expect(setArg.summary).toBe("Refreshed summary.");
    expect(setArg.model).toBe("model-x");
    expect(setArg.refreshCount).toBe(1);
    // PER-115: the summary by area is overwritten with the refresh.
    expect(setArg.headline).toBe("Solid week.");
    expect(setArg.areas).toEqual(AREAS);
    expect(setArg.ask).toBe("Ask about sleep.");
    expect(setArg.weekOfProgramme).toEqual({ week: 3, of: 8 });
    expect(setArg.generatedAt).toBeInstanceOf(Date);
    expect(where).toHaveBeenCalledTimes(1);
  });
});

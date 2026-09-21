import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { reconcilePendingBodyMeasurements } from "../pending-body-measurements";

const date = "2026-09-21";
function queue(
  storage: InMemoryStorageAdapter,
  payload: unknown,
  entityId: string | null = date,
) {
  return storage.enqueueMutation({
    entityType: "measurement",
    entityId: entityId ?? undefined,
    operation: "create",
    endpoint: "/measurements",
    method: "POST",
    payload,
  });
}
it("merges latest same-day intent without losing other metrics or dates", () => {
  const storage = new InMemoryStorageAdapter();
  queue(storage, { weightKg: 80, measuredAt: `${date}T08:00:00Z` });
  queue(storage, { bodyFatPercentage: 21, measuredAt: `${date}T09:00:00Z` });
  const result = reconcilePendingBodyMeasurements(storage, [
    { date: "2026-09-20", weightKg: 79, bodyFat: null },
    { date, weightKg: 70, bodyFat: 20 },
  ]);
  expect(result).toEqual([
    { date: "2026-09-20", weightKg: 79, bodyFat: null },
    { date, weightKg: 80, bodyFat: 21, measuredAt: `${date}T09:00:00Z` },
  ]);
});
it("ignores terminal, unrelated and malformed queue entries", () => {
  const storage = new InMemoryStorageAdapter();
  queue(storage, { weightKg: 80 });
  const entry = storage.getUncompletedMutations()[0];
  storage.patchQueueEntryForTest(entry.id, { status: "permanently_failed" });
  for (const payload of [
    null,
    [],
    "bad",
    { weightKg: "bad" },
    { bodyFatPercentage: "bad" },
  ])
    queue(storage, payload);
  queue(storage, { weightKg: 80 }, null);
  queue(storage, { weightKg: 90 });
  const last = storage.getUncompletedMutations().at(-1)!;
  storage.patchQueueEntryForTest(last.id, { payload: "invalid json" });
  queue(storage, { weightKg: 90 });
  storage.patchQueueEntryForTest(storage.getUncompletedMutations().at(-1)!.id, {
    entityType: "profile",
  });
  queue(storage, { weightKg: 90 });
  storage.patchQueueEntryForTest(storage.getUncompletedMutations().at(-1)!.id, {
    endpoint: "/other",
  });
  queue(storage, { weightKg: 90 });
  storage.patchQueueEntryForTest(storage.getUncompletedMutations().at(-1)!.id, {
    method: "PATCH",
  });
  expect(reconcilePendingBodyMeasurements(storage, [])).toEqual([]);
});
it("supports weight-only and body-fat-only records without prior server rows", () => {
  const storage = new InMemoryStorageAdapter();
  queue(storage, { weightKg: 80 }, "2026-09-20");
  queue(storage, { bodyFatPercentage: 22 });
  expect(reconcilePendingBodyMeasurements(storage, [])).toEqual([
    { date: "2026-09-20", weightKg: 80, bodyFat: null, measuredAt: undefined },
    { date, weightKg: null, bodyFat: 22, measuredAt: undefined },
  ]);
});

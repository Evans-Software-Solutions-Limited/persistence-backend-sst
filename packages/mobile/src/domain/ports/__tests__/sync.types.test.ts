import {
  isAutoResolvableSyncEntry,
  type SyncStatus,
} from "@/domain/ports/sync.types";

describe("isAutoResolvableSyncEntry", () => {
  it.each<[SyncStatus, number, number, boolean]>([
    ["pending", 0, 3, true],
    ["in_flight", 0, 3, true],
    ["failed", 2, 3, true],
    ["failed", 3, 3, false],
    ["permanently_failed", 0, 3, false],
    ["blocked_entitlement", 0, 3, false],
    ["completed", 0, 3, false],
  ])(
    "returns %s retryCount=%i/%i as auto-resolvable=%s",
    (status, retryCount, maxRetries, expected) => {
      expect(
        isAutoResolvableSyncEntry({ status, retryCount, maxRetries }),
      ).toBe(expected);
    },
  );
});

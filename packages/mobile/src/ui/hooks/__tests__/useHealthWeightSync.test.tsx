import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ok, fail, type Result } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { ApiMeasurement } from "@/domain/ports/api.port";
import type {
  HealthError,
  HealthPermissionStatus,
} from "@/domain/ports/health.port";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  useHealthWeightSync,
  HEALTH_WEIGHT_SYNC_KEY,
} from "@/ui/hooks/useHealthWeightSync";

jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: { userId: "client-1" } }),
}));

function measurement(over: Partial<ApiMeasurement>): ApiMeasurement {
  return {
    id: "m",
    userId: "client-1",
    loggedByUserId: null,
    weightKg: null,
    bodyFatPercentage: null,
    chestCm: null,
    waistCm: null,
    hipsCm: null,
    leftArmCm: null,
    rightArmCm: null,
    leftThighCm: null,
    rightThighCm: null,
    notes: null,
    measuredAt: null,
    ...over,
  };
}

const PERMS_GRANTED: HealthPermissionStatus = {
  steps: "granted",
  calories: "granted",
  bodyWeight: "granted",
  heartRate: "granted",
  sleep: "granted",
};

type Stubs = {
  measurements: ApiMeasurement[];
  cursor: string | null;
  available?: boolean;
  perms?: HealthPermissionStatus;
  writeResult?: Result<void, HealthError>;
};

function setup(s: Stubs) {
  const writeBodyWeight = jest.fn(async () => s.writeResult ?? ok(undefined));
  const setLastSyncedAt = jest.fn();
  const adapters = {
    api: { getMeasurements: jest.fn(async () => ok(s.measurements)) },
    storage: {
      getLastSyncedAt: jest.fn(() => s.cursor),
      setLastSyncedAt,
    },
    health: {
      isAvailable: jest.fn(async () => s.available ?? true),
      getPermissionStatus: jest.fn(async () => s.perms ?? PERMS_GRANTED),
      writeBodyWeight,
    },
  } as unknown as Adapters;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  renderHook(() => useHealthWeightSync(), { wrapper });
  return { writeBodyWeight, setLastSyncedAt };
}

describe("useHealthWeightSync", () => {
  it("writes coach-logged weights newer than the cursor and advances it", async () => {
    const { writeBodyWeight, setLastSyncedAt } = setup({
      cursor: "2026-06-05T00:00:00.000Z",
      measurements: [
        // self-logged → skipped
        measurement({
          id: "self",
          loggedByUserId: null,
          weightKg: "70",
          measuredAt: "2026-06-09T00:00:00.000Z",
        }),
        // coach-logged, newer → written
        measurement({
          id: "coach-new",
          loggedByUserId: "trainer-1",
          weightKg: "80",
          measuredAt: "2026-06-10T00:00:00.000Z",
        }),
        // coach-logged, older than cursor → skipped
        measurement({
          id: "coach-old",
          loggedByUserId: "trainer-1",
          weightKg: "79",
          measuredAt: "2026-06-01T00:00:00.000Z",
        }),
      ],
    });

    await waitFor(() => expect(writeBodyWeight).toHaveBeenCalledTimes(1));
    expect(writeBodyWeight).toHaveBeenCalledWith(
      80,
      new Date("2026-06-10T00:00:00.000Z"),
    );
    expect(setLastSyncedAt).toHaveBeenCalledWith(
      HEALTH_WEIGHT_SYNC_KEY,
      "2026-06-10T00:00:00.000Z",
    );
  });

  it("does nothing when health is unavailable", async () => {
    const { writeBodyWeight } = setup({
      available: false,
      cursor: null,
      measurements: [
        measurement({
          loggedByUserId: "trainer-1",
          weightKg: "80",
          measuredAt: "2026-06-10T00:00:00.000Z",
        }),
      ],
    });
    // Give the effect a tick; nothing should be written.
    await new Promise((r) => setTimeout(r, 10));
    expect(writeBodyWeight).not.toHaveBeenCalled();
  });

  it("does nothing when bodyWeight permission is not granted", async () => {
    const { writeBodyWeight } = setup({
      perms: { ...PERMS_GRANTED, bodyWeight: "denied" },
      cursor: null,
      measurements: [
        measurement({
          loggedByUserId: "trainer-1",
          weightKg: "80",
          measuredAt: "2026-06-10T00:00:00.000Z",
        }),
      ],
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(writeBodyWeight).not.toHaveBeenCalled();
  });

  it("stops advancing the cursor at the first failed write", async () => {
    const { writeBodyWeight, setLastSyncedAt } = setup({
      cursor: null,
      writeResult: fail({
        kind: "health",
        code: "write_failed",
        message: "x",
      }),
      measurements: [
        measurement({
          loggedByUserId: "trainer-1",
          weightKg: "80",
          measuredAt: "2026-06-10T00:00:00.000Z",
        }),
      ],
    });
    await waitFor(() => expect(writeBodyWeight).toHaveBeenCalled());
    expect(setLastSyncedAt).not.toHaveBeenCalled();
  });
});

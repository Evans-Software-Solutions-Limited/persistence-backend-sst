import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type {
  ApiMeasurement,
  LogMeasurementInput,
} from "@/domain/ports/api.port";
import type {
  HealthBodyFat,
  HealthPermissionStatus,
  HealthWeight,
} from "@/domain/ports/health.port";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useHealthBodyPushSync } from "@/ui/hooks/useHealthBodyPushSync";

jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: { userId: "user-1" } }),
}));

function measurement(over: Partial<ApiMeasurement>): ApiMeasurement {
  return {
    id: "m",
    userId: "user-1",
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
};

type Stubs = {
  measurements?: ApiMeasurement[];
  measurementsFail?: boolean;
  healthWeight?: HealthWeight | null;
  healthFat?: HealthBodyFat | null;
  available?: boolean;
  perms?: HealthPermissionStatus;
};

// All fixture timestamps sit at midday so the local calendar day matches the
// UTC day in any test-runner timezone within ±11h.
function setup(s: Stubs) {
  const logMeasurement = jest.fn(async (_input: LogMeasurementInput) =>
    ok(measurement({ id: "new" })),
  );
  const adapters = {
    api: {
      getMeasurements: jest.fn(async () =>
        s.measurementsFail
          ? fail({ kind: "api", code: "network", message: "offline" })
          : ok(s.measurements ?? []),
      ),
      logMeasurement,
    },
    health: {
      isAvailable: jest.fn(async () => s.available ?? true),
      getPermissionStatus: jest.fn(async () => s.perms ?? PERMS_GRANTED),
      getLatestBodyWeight: jest.fn(async () => ok(s.healthWeight ?? null)),
      getLatestBodyFat: jest.fn(async () => ok(s.healthFat ?? null)),
    },
  } as unknown as Adapters;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  renderHook(() => useHealthBodyPushSync(), { wrapper });
  return { logMeasurement, adapters };
}

/** Give the mount effect a tick when the expectation is "nothing happened". */
const settle = () => new Promise((r) => setTimeout(r, 10));

describe("useHealthBodyPushSync", () => {
  it("pushes a same-day weight + fat pair as ONE measurement with the sample's measuredAt", async () => {
    const { logMeasurement } = setup({
      measurements: [
        measurement({
          weightKg: "80",
          bodyFatPercentage: "21",
          measuredAt: "2026-06-20T12:00:00.000Z",
        }),
      ],
      healthWeight: {
        value: 78.4,
        unit: "kg",
        date: "2026-06-25T12:00:00.000Z",
      },
      healthFat: { value: 19.2, date: "2026-06-25T13:00:00.000Z" },
    });

    await waitFor(() => expect(logMeasurement).toHaveBeenCalledTimes(1));
    expect(logMeasurement).toHaveBeenCalledWith({
      weightKg: 78.4,
      bodyFatPercentage: 19.2,
      // The later of the two sample timestamps.
      measuredAt: "2026-06-25T13:00:00.000Z",
    });
  });

  it("skips readings on the SAME local day as the server's latest (self weigh-in / coach-log echo guard)", async () => {
    // A self weigh-in mirrors into HealthKit at local noon while the server
    // row is stamped at request time — same day, arbitrary clock order. The
    // day-granularity rule must treat that as already-synced.
    const { logMeasurement } = setup({
      measurements: [
        measurement({
          weightKg: "78",
          bodyFatPercentage: "19",
          measuredAt: "2026-06-25T09:14:00.000Z",
        }),
      ],
      healthWeight: {
        value: 78,
        unit: "kg",
        date: "2026-06-25T12:00:00.000Z",
      },
      healthFat: { value: 19, date: "2026-06-25T12:00:00.000Z" },
    });
    await settle();
    expect(logMeasurement).not.toHaveBeenCalled();
  });

  it("pushes weight and fat SEPARATELY when their sample days differ", async () => {
    const { logMeasurement } = setup({
      measurements: [
        measurement({
          weightKg: "80",
          bodyFatPercentage: "21",
          measuredAt: "2026-06-20T12:00:00.000Z",
        }),
      ],
      healthWeight: {
        value: 78.4,
        unit: "kg",
        date: "2026-06-25T12:00:00.000Z",
      },
      healthFat: { value: 19.2, date: "2026-06-24T12:00:00.000Z" },
    });

    await waitFor(() => expect(logMeasurement).toHaveBeenCalledTimes(2));
    expect(logMeasurement).toHaveBeenCalledWith({
      weightKg: 78.4,
      measuredAt: "2026-06-25T12:00:00.000Z",
    });
    expect(logMeasurement).toHaveBeenCalledWith({
      bodyFatPercentage: 19.2,
      measuredAt: "2026-06-24T12:00:00.000Z",
    });
  });

  it("converts an lbs HealthKit weight to kg on the wire", async () => {
    const { logMeasurement } = setup({
      measurements: [],
      healthWeight: {
        value: 176,
        unit: "lbs",
        date: "2026-06-25T12:00:00.000Z",
      },
    });
    await waitFor(() => expect(logMeasurement).toHaveBeenCalledTimes(1));
    const arg = logMeasurement.mock.calls[0][0];
    expect(arg.weightKg).toBeCloseTo(79.83, 2);
  });

  it("dedups weight and fat INDEPENDENTLY (fresh fat, already-synced weight)", async () => {
    const { logMeasurement } = setup({
      measurements: [
        // Weight already on the server for the sample's day...
        measurement({
          weightKg: "78",
          measuredAt: "2026-06-25T09:00:00.000Z",
        }),
        // ...fat last logged days earlier (girth-style row ordering noise).
        measurement({
          bodyFatPercentage: "21",
          measuredAt: "2026-06-20T09:00:00.000Z",
        }),
      ],
      healthWeight: {
        value: 78,
        unit: "kg",
        date: "2026-06-25T12:00:00.000Z",
      },
      healthFat: { value: 19.2, date: "2026-06-25T13:00:00.000Z" },
    });

    await waitFor(() => expect(logMeasurement).toHaveBeenCalledTimes(1));
    expect(logMeasurement).toHaveBeenCalledWith({
      bodyFatPercentage: 19.2,
      measuredAt: "2026-06-25T13:00:00.000Z",
    });
  });

  it("does NOT push when the server read fails (fetch-before-push)", async () => {
    const { logMeasurement, adapters } = setup({
      measurementsFail: true,
      healthWeight: {
        value: 78.4,
        unit: "kg",
        date: "2026-06-25T12:00:00.000Z",
      },
    });
    await settle();
    expect(adapters.api.getMeasurements).toHaveBeenCalled();
    expect(logMeasurement).not.toHaveBeenCalled();
  });

  it("pushes when the server has no measurements at all", async () => {
    const { logMeasurement } = setup({
      measurements: [],
      healthWeight: {
        value: 78.4,
        unit: "kg",
        date: "2026-06-25T12:00:00.000Z",
      },
    });
    await waitFor(() => expect(logMeasurement).toHaveBeenCalledTimes(1));
  });

  it("skips future-dated and out-of-range samples", async () => {
    const { logMeasurement } = setup({
      measurements: [],
      // Future-dated weight (device clock skew) → never pushed.
      healthWeight: {
        value: 78.4,
        unit: "kg",
        date: "2999-01-01T12:00:00.000Z",
      },
      // Out-of-range fat → never pushed.
      healthFat: { value: 100, date: "2026-06-25T12:00:00.000Z" },
    });
    await settle();
    expect(logMeasurement).not.toHaveBeenCalled();
  });

  it("does nothing when health is unavailable", async () => {
    const { logMeasurement, adapters } = setup({
      available: false,
      healthWeight: {
        value: 78.4,
        unit: "kg",
        date: "2026-06-25T12:00:00.000Z",
      },
    });
    await settle();
    expect(logMeasurement).not.toHaveBeenCalled();
    expect(adapters.api.getMeasurements).not.toHaveBeenCalled();
  });

  it("does nothing when the bodyWeight permission is not granted", async () => {
    const { logMeasurement } = setup({
      perms: { ...PERMS_GRANTED, bodyWeight: "denied" },
      healthWeight: {
        value: 78.4,
        unit: "kg",
        date: "2026-06-25T12:00:00.000Z",
      },
    });
    await settle();
    expect(logMeasurement).not.toHaveBeenCalled();
  });

  it("does nothing when HealthKit has no samples", async () => {
    const { logMeasurement, adapters } = setup({ measurements: [] });
    await settle();
    expect(logMeasurement).not.toHaveBeenCalled();
    // No samples → no reason to hit the server either.
    expect(adapters.api.getMeasurements).not.toHaveBeenCalled();
  });
});

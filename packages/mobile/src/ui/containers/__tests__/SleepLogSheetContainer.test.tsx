import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { StubHealthAdapter } from "@/adapters/health";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { SleepLogSheetContainer } from "../SleepLogSheetContainer";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

const USER = "user-1";

function makeAdapters(): {
  adapters: Adapters;
  storage: InMemoryStorageAdapter;
} {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    storage,
    adapters: {
      api,
      auth,
      storage,
      health: new StubHealthAdapter(),
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    },
  };
}

describe("SleepLogSheetContainer", () => {
  beforeEach(() => mockFetch.mockClear());

  it("logs the sleep entry and closes on save", async () => {
    // The mocked fetch resolves immediately, so by the time onClose fires the
    // sync worker has already drained the entry (pending -> completed) — assert
    // against the POST the worker actually sent, not the (by-then-empty)
    // pending queue.
    const { adapters } = makeAdapters();
    const onClose = jest.fn();
    const { getByText } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <SleepLogSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    fireEvent.press(getByText(/Log 8h 0m/));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.test/health/sleep");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(init.body as string) as {
      durationMinutes: number;
    };
    expect(payload.durationMinutes).toBe(480);
  });

  it("synthesises sleepStart/sleepEnd anchored at 07:00 local wake (Decision D1)", async () => {
    const { adapters } = makeAdapters();
    const onClose = jest.fn();
    const { getByText } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <SleepLogSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    fireEvent.press(getByText(/Log 8h 0m/));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const [, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const payload = JSON.parse(init.body as string) as {
      sleepDate: string;
      durationMinutes: number;
      sleepStart: string;
      sleepEnd: string;
    };
    const end = new Date(payload.sleepEnd);
    const start = new Date(payload.sleepStart);
    expect(end.getHours()).toBe(7);
    expect(end.getTime() - start.getTime()).toBe(480 * 60_000);
  });

  it("prefills the duration from HealthKit's last-night reading when available", async () => {
    const { adapters } = makeAdapters();
    Object.assign(adapters.health, {
      getSleepLastNight: async () =>
        ok({
          durationMinutes: 405,
          start: new Date("2026-07-15T23:15:00Z"),
          end: new Date("2026-07-16T06:00:00Z"),
        }),
    });
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <SleepLogSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    await waitFor(() =>
      expect(getByTestId("sleep-hours-value").props.children).toBe(6),
    );
    expect(getByTestId("sleep-minutes-value").props.children).toBe(45);
  });

  it("mirrors the entry to Apple Health only after the save is accepted", async () => {
    const { adapters } = makeAdapters();
    const writeSleep = jest.fn(async () => ok(undefined));
    Object.assign(adapters.health, { writeSleep });
    const onClose = jest.fn();
    const { getByText } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <SleepLogSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    fireEvent.press(getByText(/Log 8h 0m/));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writeSleep).toHaveBeenCalledTimes(1);
    const [start, end] = writeSleep.mock.calls[0] as unknown as [Date, Date];
    expect(end.getTime() - start.getTime()).toBe(480 * 60_000);
  });

  it("a HealthKit mirror failure never fails or blocks the save", async () => {
    const { adapters } = makeAdapters();
    const writeSleep = jest.fn(async () => {
      throw new Error("healthkit boom");
    });
    Object.assign(adapters.health, { writeSleep });
    const onClose = jest.fn();
    const { getByText } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <SleepLogSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    fireEvent.press(getByText(/Log 8h 0m/));
    // The durable save + close still happen even though the fire-and-forget
    // mirror call rejects.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("the presenter disables Save at a zero duration, so no write ever fires", async () => {
    // The steppers floor at 0h/0m and the Save CTA disables at that point
    // (SleepLogSheetPresenter's `canSave` gate) — this proves the container
    // never even gets a chance to call the command with an invalid duration.
    const { adapters } = makeAdapters();
    const writeSleep = jest.fn(async () => ok(undefined));
    Object.assign(adapters.health, { writeSleep });
    const onClose = jest.fn();
    const { getByLabelText, getByText } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <SleepLogSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    for (let i = 0; i < 8; i++) {
      fireEvent.press(getByLabelText("Decrease hours"));
    }
    await act(async () => {
      fireEvent.press(getByText(/Log 0h 0m/));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(writeSleep).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

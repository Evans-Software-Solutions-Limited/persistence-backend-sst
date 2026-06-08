import { fireEvent, waitFor } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { WeighInSheetContainer } from "../WeighInSheetContainer";

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
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    },
  };
}

describe("WeighInSheetContainer", () => {
  beforeEach(() => mockFetch.mockClear());

  it("logs the weigh-in and closes on save", async () => {
    const { adapters } = makeAdapters();
    const onClose = jest.fn();
    const { getByText } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <WeighInSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    fireEvent.press(getByText(/Log/));
    // Save → useLogMeasurement (optimistic append + queue + drain) → close.
    // The optimistic body-trend write itself is unit-tested in
    // log-measurement.command.test (06.6); here we prove the container wiring.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

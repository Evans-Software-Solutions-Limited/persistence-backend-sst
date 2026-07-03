import { render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ok, fail } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { ClientDetailProps } from "@/ui/presenters/coach/ClientDetailPresenter";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams: { id?: string; name?: string } = {
  id: "client-1",
  name: "Jordan",
};
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => mockParams,
  // Focus-driven refresh is exercised on-device; here it's a mount no-op.
  useFocusEffect: jest.fn(),
}));

const mockCaptured: { props: ClientDetailProps | null } = { props: null };
jest.mock("@/ui/presenters/coach/ClientDetailPresenter", () => ({
  ClientDetailPresenter: (props: ClientDetailProps) => {
    mockCaptured.props = props;
    return null;
  },
}));

import {
  ClientDetailContainer,
  buildClientBodyTrend,
} from "@/ui/containers/ClientDetailContainer";

function props(): ClientDetailProps {
  if (!mockCaptured.props) throw new Error("presenter not rendered");
  return mockCaptured.props;
}

function renderWithApi(getClientBodyTrend: jest.Mock) {
  const adapters = { api: { getClientBodyTrend } } as unknown as Adapters;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return render(<ClientDetailContainer />, { wrapper });
}

describe("buildClientBodyTrend", () => {
  it("builds series + deltas, skipping null gaps per field", () => {
    const trend = buildClientBodyTrend([
      { date: "2026-06-01", weightKg: 82, bodyFat: null },
      { date: "2026-06-10", weightKg: null, bodyFat: 22 },
      { date: "2026-06-20", weightKg: 80, bodyFat: 21 },
    ]);
    expect(trend.weight).toEqual({
      current: 80,
      delta: -2,
      series: [82, 80],
      unit: "kg",
    });
    expect(trend.bodyFat).toEqual({
      current: 21,
      delta: -1,
      series: [22, 21],
    });
  });

  it("handles an empty series", () => {
    const trend = buildClientBodyTrend([]);
    expect(trend.weight.current).toBeNull();
    expect(trend.weight.delta).toBe(0);
    expect(trend.bodyFat.series).toEqual([]);
  });
});

describe("ClientDetailContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams.id = "client-1";
    mockParams.name = "Jordan";
  });

  it("fetches the trend and passes shaped props through", async () => {
    const getClientBodyTrend = jest.fn(async () =>
      ok([
        { date: "2026-06-20", weightKg: 80, bodyFat: 21 },
        { date: "2026-06-25", weightKg: 79.2, bodyFat: 20.4 },
      ]),
    );
    renderWithApi(getClientBodyTrend);
    await waitFor(() => expect(props().isLoading).toBe(false));
    expect(props().clientName).toBe("Jordan");
    expect(props().bodyTrend.weight.current).toBe(79.2);
    expect(props().bodyTrend.bodyFat.series).toEqual([21, 20.4]);
    expect(props().error).toBeNull();
    expect(getClientBodyTrend).toHaveBeenCalledWith("client-1", "30d");
  });

  it("maps a fetch failure to a user-facing error", async () => {
    renderWithApi(
      jest.fn(async () =>
        fail({ kind: "api", code: "server", message: "boom" }),
      ),
    );
    await waitFor(() => expect(props().error).not.toBeNull());
    expect(props().bodyTrend.weight.series).toEqual([]);
  });

  it("routes Log weight with the client id + name", async () => {
    renderWithApi(jest.fn(async () => ok([])));
    await waitFor(() => expect(props().isLoading).toBe(false));
    props().onLogWeight();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/clients/[id]/log-weight",
      params: { id: "client-1", name: "Jordan" },
    });
  });

  it("navigates back", async () => {
    renderWithApi(jest.fn(async () => ok([])));
    await waitFor(() => expect(props().isLoading).toBe(false));
    props().onBack();
    expect(mockBack).toHaveBeenCalled();
  });
});

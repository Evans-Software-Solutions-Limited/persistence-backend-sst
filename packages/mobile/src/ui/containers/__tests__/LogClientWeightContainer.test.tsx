import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ok, fail, type ApiError } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { LogClientWeightProps } from "@/ui/presenters/LogClientWeightPresenter";

const mockBack = jest.fn();
const mockParams: { id?: string; name?: string } = {
  id: "client-1",
  name: "Jordan",
};
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));

const mockCaptured: { props: LogClientWeightProps | null } = { props: null };
jest.mock("@/ui/presenters/LogClientWeightPresenter", () => ({
  LogClientWeightPresenter: (props: LogClientWeightProps) => {
    mockCaptured.props = props;
    return null;
  },
}));

import { LogClientWeightContainer } from "@/ui/containers/LogClientWeightContainer";

function props(): LogClientWeightProps {
  if (!mockCaptured.props) throw new Error("presenter not rendered");
  return mockCaptured.props;
}

function renderWithApi(logClientWeight: jest.Mock) {
  const adapters = { api: { logClientWeight } } as unknown as Adapters;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return render(<LogClientWeightContainer />, { wrapper });
}

describe("LogClientWeightContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams.id = "client-1";
    mockParams.name = "Jordan";
  });

  it("passes the client name through", () => {
    renderWithApi(jest.fn(async () => ok({})));
    expect(props().clientName).toBe("Jordan");
  });

  it("logs the weight then navigates back on success", async () => {
    const logClientWeight = jest.fn(async () => ok({}));
    renderWithApi(logClientWeight);
    await act(async () => {
      await props().onSave(82);
    });
    expect(logClientWeight).toHaveBeenCalledWith("client-1", { weightKg: 82 });
    expect(props().success).toBe(true);
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it("surfaces an error on failure", async () => {
    const err: ApiError = { kind: "api", code: "server", message: "no" };
    renderWithApi(jest.fn(async () => fail(err)));
    await act(async () => {
      await props().onSave(82);
    });
    expect(props().error).toBeTruthy();
    expect(props().success).toBe(false);
  });

  it("no-ops when the route has no client id", async () => {
    mockParams.id = undefined;
    const logClientWeight = jest.fn(async () => ok({}));
    renderWithApi(logClientWeight);
    await act(async () => {
      await props().onSave(82);
    });
    expect(logClientWeight).not.toHaveBeenCalled();
  });
});

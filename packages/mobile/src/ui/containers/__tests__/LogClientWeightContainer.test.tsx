import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ok, fail, type ApiError } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { LogClientWeightProps } from "@/ui/presenters/LogClientWeightPresenter";

import { LogClientWeightContainer } from "@/ui/containers/LogClientWeightContainer";

const mockBack = jest.fn();
const mockParams: { id?: string; name?: string } = {
  id: "client-1",
  name: "Jordan",
};
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));

const mockProfile: { weightUnit: "kg" | "lb" | null } = { weightUnit: null };
jest.mock("@/ui/hooks/useProfilePage", () => ({
  useProfilePage: () => ({
    payload: mockProfile.weightUnit
      ? { profile: { weightUnit: mockProfile.weightUnit } }
      : null,
  }),
}));

const mockCaptured: { props: LogClientWeightProps | null } = { props: null };
jest.mock("@/ui/presenters/LogClientWeightPresenter", () => ({
  LogClientWeightPresenter: (props: LogClientWeightProps) => {
    mockCaptured.props = props;
    return null;
  },
}));

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
    mockProfile.weightUnit = null;
  });

  it("passes the client name through", () => {
    renderWithApi(jest.fn(async () => ok({})));
    expect(props().clientName).toBe("Jordan");
    expect(props().defaultUnit).toBeUndefined();
  });

  it("starts the unit toggle on the coach's weight preference (PER-98)", () => {
    mockProfile.weightUnit = "lb";
    renderWithApi(jest.fn(async () => ok({})));
    expect(props().defaultUnit).toBe("lb");
  });

  it("logs the weight then navigates back on success", async () => {
    const logClientWeight = jest.fn(async () => ok({}));
    renderWithApi(logClientWeight);
    await act(async () => {
      await props().onSave({ weightKg: 82, bodyFatPercentage: null });
    });
    // Body fat left blank → the key is omitted from the request entirely.
    expect(logClientWeight).toHaveBeenCalledWith("client-1", { weightKg: 82 });
    expect(props().success).toBe(true);
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it("includes bodyFatPercentage when the coach filled it in", async () => {
    const logClientWeight = jest.fn(async () => ok({}));
    renderWithApi(logClientWeight);
    await act(async () => {
      await props().onSave({ weightKg: 82, bodyFatPercentage: 19.5 });
    });
    expect(logClientWeight).toHaveBeenCalledWith("client-1", {
      weightKg: 82,
      bodyFatPercentage: 19.5,
    });
  });

  it("surfaces an error on failure", async () => {
    const err: ApiError = { kind: "api", code: "server", message: "no" };
    renderWithApi(jest.fn(async () => fail(err)));
    await act(async () => {
      await props().onSave({ weightKg: 82, bodyFatPercentage: null });
    });
    expect(props().error).toBeTruthy();
    expect(props().success).toBe(false);
  });

  it("no-ops when the route has no client id", async () => {
    mockParams.id = undefined;
    const logClientWeight = jest.fn(async () => ok({}));
    renderWithApi(logClientWeight);
    await act(async () => {
      await props().onSave({ weightKg: 82, bodyFatPercentage: null });
    });
    expect(logClientWeight).not.toHaveBeenCalled();
  });
});

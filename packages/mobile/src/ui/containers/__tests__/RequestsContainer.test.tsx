import { render } from "@testing-library/react-native";
import type { RequestsPresenterProps } from "@/ui/presenters/RequestsPresenter";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockNav = { canGoBack: true };
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockNav.canGoBack,
  }),
}));

const mockRespond = jest.fn(async () => ({ ok: true as const, value: {} }));
const mockRefresh = jest.fn();
const mockHookState = {
  data: [],
  isLoading: false,
  isRefreshing: false,
  error: null,
  refresh: mockRefresh,
  respond: mockRespond,
  pendingIds: new Set<string>(),
};
jest.mock("@/ui/hooks/useClientRelationships", () => ({
  useClientRelationships: jest.fn(() => mockHookState),
}));

const mockCaptured: { props: RequestsPresenterProps | null } = { props: null };
jest.mock("@/ui/presenters/RequestsPresenter", () => ({
  RequestsPresenter: (props: RequestsPresenterProps) => {
    mockCaptured.props = props;
    return null;
  },
}));

import { RequestsContainer } from "@/ui/containers/RequestsContainer";
import { useClientRelationships } from "@/ui/hooks/useClientRelationships";

function props(): RequestsPresenterProps {
  if (!mockCaptured.props) throw new Error("presenter not rendered");
  return mockCaptured.props;
}

describe("RequestsContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNav.canGoBack = true;
  });

  it("queries pending relationships and forwards hook state", () => {
    render(<RequestsContainer />);
    expect(useClientRelationships).toHaveBeenCalledWith("pending");
    expect(props().requests).toBe(mockHookState.data);
    expect(props().onRefresh).toBe(mockRefresh);
  });

  it("wires accept / decline to respond", () => {
    render(<RequestsContainer />);
    props().onAccept("rel-1");
    props().onDecline("rel-2");
    expect(mockRespond).toHaveBeenCalledWith("rel-1", "accept");
    expect(mockRespond).toHaveBeenCalledWith("rel-2", "decline");
  });

  it("goes back when possible", () => {
    render(<RequestsContainer />);
    props().onBack();
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("replaces to You when there's no back stack", () => {
    mockNav.canGoBack = false;
    render(<RequestsContainer />);
    props().onBack();
    expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)/you");
  });
});

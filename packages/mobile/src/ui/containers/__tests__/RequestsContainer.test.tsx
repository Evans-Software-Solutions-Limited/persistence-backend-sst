import { render } from "@testing-library/react-native";
import type { RequestsPresenterProps } from "@/ui/presenters/RequestsPresenter";
import type { ClientTrainerRelationship } from "@/domain/models/clientRelationship";

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
const mockHookState: {
  data: ClientTrainerRelationship[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: null;
  refresh: typeof mockRefresh;
  respond: typeof mockRespond;
  pendingIds: Set<string>;
} = {
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
    mockHookState.data = [];
  });

  it("queries pending relationships and forwards hook state", () => {
    render(<RequestsContainer />);
    expect(useClientRelationships).toHaveBeenCalledWith("pending");
    expect(props().requests).toEqual(mockHookState.data);
    expect(props().onRefresh).toBe(mockRefresh);
  });

  it("filters out client-initiated pendings (Phase 8 — coach-accepted, not the athlete's to review)", () => {
    mockHookState.data = [
      {
        relationshipId: "rel-trainer",
        trainerId: "t-1",
        trainerName: "Coach Carter",
        trainerRole: "personal_trainer",
        trainerAvatarUrl: null,
        status: "pending",
        relationshipReason: null,
        since: null,
        initiatedBy: "trainer",
      },
      {
        relationshipId: "rel-client",
        trainerId: "t-2",
        trainerName: "Dr. Lee",
        trainerRole: "physiotherapist",
        trainerAvatarUrl: null,
        status: "pending",
        relationshipReason: null,
        since: null,
        initiatedBy: "client",
      },
    ];
    render(<RequestsContainer />);
    expect(props().requests).toHaveLength(1);
    expect(props().requests[0].relationshipId).toBe("rel-trainer");
  });

  it("still shows a pending whose initiatedBy is missing (deploy-ordering safety)", () => {
    // A backend that hasn't shipped `initiatedBy` on this endpoint sends it as
    // undefined. It must remain acceptable (pre-Phase-8 behaviour), not vanish.
    mockHookState.data = [
      {
        relationshipId: "rel-legacy",
        trainerId: "t-1",
        trainerName: "Coach Carter",
        trainerRole: "personal_trainer",
        trainerAvatarUrl: null,
        status: "pending",
        relationshipReason: null,
        since: null,
        // @ts-expect-error simulating a payload from a backend without the field
        initiatedBy: undefined,
      },
    ];
    render(<RequestsContainer />);
    expect(props().requests).toHaveLength(1);
    expect(props().requests[0].relationshipId).toBe("rel-legacy");
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

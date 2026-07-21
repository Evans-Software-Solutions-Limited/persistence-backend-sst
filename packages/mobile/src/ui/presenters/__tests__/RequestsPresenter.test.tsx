import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  RequestsPresenter,
  roleLabel,
  type RequestsPresenterProps,
} from "../RequestsPresenter";
import type { ClientTrainerRelationship } from "@/domain/models/clientRelationship";

function rel(
  over: Partial<ClientTrainerRelationship> = {},
): ClientTrainerRelationship {
  return {
    relationshipId: "rel-1",
    trainerId: "trainer-1",
    trainerName: "Coach Carter",
    trainerRole: "personal_trainer",
    trainerAvatarUrl: null,
    status: "pending",
    relationshipReason: null,
    since: "2026-06-01T00:00:00.000Z",
    initiatedBy: "trainer",
    ...over,
  };
}

function render(over: Partial<RequestsPresenterProps> = {}) {
  const props: RequestsPresenterProps = {
    requests: [rel()],
    pendingIds: new Set<string>(),
    isLoading: false,
    isRefreshing: false,
    error: null,
    onRefresh: jest.fn(),
    onBack: jest.fn(),
    onAccept: jest.fn(),
    onDecline: jest.fn(),
    consentVisible: false,
    onConsentClose: jest.fn(),
    onConsentConfirm: jest.fn(),
    isConsentSubmitting: false,
    ...over,
  };
  return { props, ...renderWithTheme(<RequestsPresenter {...props} />) };
}

describe("roleLabel", () => {
  it("maps known roles and falls back", () => {
    expect(roleLabel("physiotherapist")).toBe("Physiotherapist");
    expect(roleLabel("personal_trainer")).toBe("Personal Trainer");
    expect(roleLabel("admin")).toBe("Coach");
    expect(roleLabel(null)).toBe("Trainer");
    expect(roleLabel("something")).toBe("Trainer");
  });
});

describe("RequestsPresenter", () => {
  it("shows the blocking loader only when loading with no data", () => {
    const { getByTestId } = render({ requests: [], isLoading: true });
    expect(getByTestId("requests-loader")).toBeTruthy();
  });

  it("shows the error state only when errored with no data", () => {
    const { getByTestId } = render({
      requests: [],
      error: { kind: "api", code: "server", message: "boom" },
    });
    expect(getByTestId("requests-error-state")).toBeTruthy();
  });

  it("renders the empty state when there are no requests", () => {
    const { getByTestId, queryByTestId } = render({ requests: [] });
    expect(getByTestId("requests-empty")).toBeTruthy();
    expect(queryByTestId("request-card-rel-1")).toBeNull();
  });

  it("renders a card per request with the reason appended", () => {
    const { getByTestId, getByText } = render({
      requests: [rel({ relationshipReason: "Strength block" })],
    });
    expect(getByTestId("request-card-rel-1")).toBeTruthy();
    expect(getByText("Coach Carter")).toBeTruthy();
    expect(getByText("Personal Trainer · Strength block")).toBeTruthy();
  });

  it("fires onAccept / onDecline with the relationship id", () => {
    const { props, getByTestId } = render();
    fireEvent.press(getByTestId("request-accept-rel-1"));
    fireEvent.press(getByTestId("request-decline-rel-1"));
    expect(props.onAccept).toHaveBeenCalledWith("rel-1");
    expect(props.onDecline).toHaveBeenCalledWith("rel-1");
  });

  it("disables a row's buttons while it is pending", () => {
    const { props, getByTestId } = render({
      pendingIds: new Set(["rel-1"]),
    });
    fireEvent.press(getByTestId("request-accept-rel-1"));
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it("invokes onBack from the header", () => {
    const { props, getByLabelText } = render();
    fireEvent.press(getByLabelText("Back"));
    expect(props.onBack).toHaveBeenCalled();
  });

  // 26-coach-data-sharing-consent
  describe("data-sharing consent sheet", () => {
    it("does not render the consent sheet's confirm control until onAccept opens it", () => {
      const { queryByTestId } = render({ consentVisible: false });
      expect(queryByTestId("requests-consent-confirm")).toBeNull();
    });

    it("renders the consent sheet with an unticked checkbox and a disabled confirm when opened", () => {
      const { getByTestId } = render({ consentVisible: true });
      expect(
        getByTestId("requests-consent-checkbox").props.accessibilityState
          ?.checked,
      ).toBe(false);
      expect(
        getByTestId("requests-consent-confirm").props.accessibilityState
          ?.disabled,
      ).toBe(true);
    });

    it("cannot confirm until ticked, then confirms once ticked", () => {
      const { props, getByTestId } = render({ consentVisible: true });
      fireEvent.press(getByTestId("requests-consent-confirm"));
      expect(props.onConsentConfirm).not.toHaveBeenCalled();

      fireEvent.press(getByTestId("requests-consent-checkbox"));
      fireEvent.press(getByTestId("requests-consent-confirm"));
      expect(props.onConsentConfirm).toHaveBeenCalledTimes(1);
    });
  });
});

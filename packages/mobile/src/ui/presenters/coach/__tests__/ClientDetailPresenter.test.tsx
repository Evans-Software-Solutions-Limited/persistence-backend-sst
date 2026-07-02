import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  ClientDetailPresenter,
  type ClientDetailProps,
} from "../ClientDetailPresenter";

function render(over: Partial<ClientDetailProps> = {}) {
  const props: ClientDetailProps = {
    clientName: "Jordan",
    bodyTrend: {
      weight: { current: 79.2, delta: -0.8, series: [80, 79.2], unit: "kg" },
      bodyFat: { current: 20.4, delta: -0.6, series: [21, 20.4] },
    },
    isLoading: false,
    error: null,
    onLogWeight: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
  return { props, ...renderWithTheme(<ClientDetailPresenter {...props} />) };
}

const EMPTY_TREND: ClientDetailProps["bodyTrend"] = {
  weight: { current: null, delta: 0, series: [], unit: "kg" },
  bodyFat: { current: null, delta: 0, series: [] },
};

describe("ClientDetailPresenter", () => {
  it("renders the client name and the body trend", () => {
    const { getByText, getByTestId, queryByTestId } = render();
    expect(getByText("Jordan")).toBeTruthy();
    expect(getByTestId("client-detail-body-trend")).toBeTruthy();
    expect(queryByTestId("client-detail-empty")).toBeNull();
    expect(queryByTestId("client-detail-error")).toBeNull();
  });

  it("shows the empty hint when there are no measurements", () => {
    const { getByTestId } = render({ bodyTrend: EMPTY_TREND });
    expect(getByTestId("client-detail-empty")).toBeTruthy();
  });

  it("suppresses the empty hint while loading", () => {
    const { queryByTestId } = render({
      bodyTrend: EMPTY_TREND,
      isLoading: true,
    });
    expect(queryByTestId("client-detail-empty")).toBeNull();
  });

  it("surfaces an error", () => {
    const { getByTestId, queryByTestId } = render({
      bodyTrend: EMPTY_TREND,
      error: "Couldn't load this client's trend.",
    });
    expect(getByTestId("client-detail-error")).toBeTruthy();
    expect(queryByTestId("client-detail-empty")).toBeNull();
  });

  it("invokes onLogWeight and onBack", () => {
    const { props, getByTestId, getByLabelText } = render();
    fireEvent.press(getByTestId("client-detail-log-weight"));
    expect(props.onLogWeight).toHaveBeenCalled();
    fireEvent.press(getByLabelText("Back"));
    expect(props.onBack).toHaveBeenCalled();
  });

  it("falls back to a generic title without a client name", () => {
    const { getByText } = render({ clientName: null });
    expect(getByText("Client")).toBeTruthy();
  });
});

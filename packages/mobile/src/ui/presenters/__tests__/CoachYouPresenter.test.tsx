import { fireEvent, renderWithTheme } from "../../../../__tests__/test-utils";
import { CoachYouPresenter } from "../CoachYouPresenter";
import {
  makeCoachOverview,
  makeEmptyCoachOverview,
} from "../coach/__tests__/coachOverview.fixture";

function baseProps() {
  return {
    overview: makeCoachOverview(),
    initials: "BE",
    coachName: "Bradley Evans",
    coachMeta: "Coach since Feb 2024 · 8 active clients",
    monthLabel: "March",
    streakCount: 23,
    streakUnit: "day",
    sessionCaption: "Last session: Upper Body · 45m",
    isLoading: false,
    isRefreshing: false,
    error: null,
    onRefresh: jest.fn(),
    onOpenDrawer: jest.fn(),
    onSwitchToAthlete: jest.fn(),
    onOpenCoachSettings: jest.fn(),
    onInvite: jest.fn(),
    onStartSession: jest.fn(),
    onViewAllPrograms: jest.fn(),
  };
}

describe("CoachYouPresenter", () => {
  it("renders the header + all sections with data", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <CoachYouPresenter {...baseProps()} />,
    );
    expect(getByText("Your practice")).toBeTruthy();
    expect(getByText("Bradley Evans")).toBeTruthy();
    expect(getByTestId("coach-business-stats")).toBeTruthy();
    expect(getByTestId("coach-client-overview")).toBeTruthy();
    expect(getByTestId("coach-training-peek")).toBeTruthy();
    expect(getByTestId("coach-program-stats")).toBeTruthy();
    expect(getByTestId("coach-recent-activity")).toBeTruthy();
  });

  it("shows the blocking loader only when loading with no data", () => {
    const { getByTestId } = renderWithTheme(
      <CoachYouPresenter {...baseProps()} overview={null} isLoading />,
    );
    expect(getByTestId("coach-you-loader")).toBeTruthy();
  });

  it("shows the error state only when error with no data", () => {
    const onRefresh = jest.fn();
    const { getByTestId } = renderWithTheme(
      <CoachYouPresenter
        {...baseProps()}
        overview={null}
        error={{ kind: "api", code: "server", message: "boom" }}
        onRefresh={onRefresh}
      />,
    );
    expect(getByTestId("coach-you-error-state")).toBeTruthy();
  });

  it("offers a switch-to-athlete escape from the error state (strand-guard)", () => {
    const props = baseProps();
    const { getByText } = renderWithTheme(
      <CoachYouPresenter
        {...props}
        overview={null}
        error={{ kind: "api", code: "unauthorized", message: "403" }}
      />,
    );
    fireEvent.press(getByText("Switch to athlete mode"));
    expect(props.onSwitchToAthlete).toHaveBeenCalledTimes(1);
  });

  it("keeps rendering cached data when an error arrives with data present", () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <CoachYouPresenter
        {...baseProps()}
        error={{ kind: "api", code: "network", message: "offline" }}
      />,
    );
    expect(queryByTestId("coach-you-error-state")).toBeNull();
    expect(getByText("Your practice")).toBeTruthy();
  });

  it("wires the avatar, mode-switch, settings, and invite callbacks", () => {
    const props = baseProps();
    const { getByTestId } = renderWithTheme(<CoachYouPresenter {...props} />);
    fireEvent.press(getByTestId("coach-you-avatar"));
    expect(props.onOpenDrawer).toHaveBeenCalled();
    fireEvent.press(getByTestId("coach-switch-athlete"));
    expect(props.onSwitchToAthlete).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId("coach-settings"));
    expect(props.onOpenCoachSettings).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId("coach-invite-btn"));
    expect(props.onInvite).toHaveBeenCalledTimes(1);
  });

  it("renders the header + mode card but no sections when overview is null (not loading/error)", () => {
    const { getByText, queryByTestId } = renderWithTheme(
      <CoachYouPresenter
        {...baseProps()}
        overview={null}
        isLoading={false}
        error={null}
      />,
    );
    // Header + mode card still render…
    expect(getByText("Your practice")).toBeTruthy();
    expect(getByText("Bradley Evans")).toBeTruthy();
    // …but the data sections are absent.
    expect(queryByTestId("coach-business-stats")).toBeNull();
    expect(queryByTestId("coach-recent-activity")).toBeNull();
  });

  it("renders the empty-state sections without crashing", () => {
    const { getByTestId } = renderWithTheme(
      <CoachYouPresenter
        {...baseProps()}
        overview={makeEmptyCoachOverview()}
      />,
    );
    expect(getByTestId("coach-programs-empty")).toBeTruthy();
    expect(getByTestId("coach-activity-empty")).toBeTruthy();
  });
});

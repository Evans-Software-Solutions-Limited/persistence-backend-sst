import { fireEvent, renderWithTheme } from "../../../../__tests__/test-utils";
import { coachInitials } from "../coaching/coachingKit";
import { CoachTabPresenter } from "../CoachTabPresenter";
import {
  COACH_CAN_SEE,
  InvitePreviewPresenter,
  type InvitePreviewPresenterProps,
} from "../InvitePreviewPresenter";

describe("coachInitials", () => {
  it("first and last initials, upper case, at most two", () => {
    expect(coachInitials("Ellie Hart")).toBe("EH");
    expect(coachInitials("ellie may hart")).toBe("EH");
    expect(coachInitials("Cher")).toBe("C");
    expect(coachInitials("  ")).toBe("");
  });
});

function previewProps(
  over: Partial<InvitePreviewPresenterProps> = {},
): InvitePreviewPresenterProps {
  return {
    coachName: "Ellie Hart",
    coachFirstName: "Ellie",
    initials: "EH",
    readyLine: "2 forms · calorie target",
    agreed: false,
    isSubmitting: false,
    isOffline: false,
    isExpired: false,
    errorMessage: "",
    onToggleAgree: jest.fn(),
    onAccept: jest.fn(),
    onCancel: jest.fn(),
    onOpenPrivacyPolicy: jest.fn(),
    ...over,
  };
}

describe("InvitePreviewPresenter (C11j)", () => {
  it("lists what the coach will see as a fixed list, sleep and heart not shared", () => {
    const { getByText, getAllByTestId, getByLabelText } = renderWithTheme(
      <InvitePreviewPresenter {...previewProps()} />,
    );
    for (const row of COACH_CAN_SEE) expect(getByText(row.label)).toBeTruthy();
    expect(getAllByTestId("invite-preview-share-on")).toHaveLength(4);
    expect(getAllByTestId("invite-preview-share-off")).toHaveLength(1);
    expect(getByLabelText("Sleep and heart data: not shared")).toBeTruthy();
    expect(getByText("Accept and start")).toBeTruthy();
    expect(getByText("Not now")).toBeTruthy();
  });

  it("raises the tick; Accept only once ticked", () => {
    const props = previewProps();
    const { getByTestId, rerender } = renderWithTheme(
      <InvitePreviewPresenter {...props} />,
    );
    fireEvent.press(getByTestId("invite-preview-agree"));
    expect(props.onToggleAgree).toHaveBeenCalled();
    fireEvent.press(getByTestId("invite-preview-accept"));
    expect(props.onAccept).not.toHaveBeenCalled();

    rerender(<InvitePreviewPresenter {...props} agreed />);
    fireEvent.press(getByTestId("invite-preview-accept"));
    expect(props.onAccept).toHaveBeenCalledTimes(1);
  });

  it("while accepting, Accept is disabled and shows progress", () => {
    const { getByTestId, getByLabelText } = renderWithTheme(
      <InvitePreviewPresenter
        {...previewProps({ agreed: true, isSubmitting: true })}
      />,
    );
    expect(
      getByTestId("invite-preview-accept").props.accessibilityState?.disabled,
    ).toBe(true);
    expect(getByLabelText("Accepting")).toBeTruthy();
  });

  it("offline wins over expired and errors; then expired; then the error", () => {
    const offline = renderWithTheme(
      <InvitePreviewPresenter
        {...previewProps({
          isOffline: true,
          isExpired: true,
          errorMessage: "x",
        })}
      />,
    );
    expect(offline.getByTestId("invite-preview-offline")).toBeTruthy();
    expect(offline.queryByTestId("invite-preview-expired")).toBeNull();

    const expired = renderWithTheme(
      <InvitePreviewPresenter
        {...previewProps({ isExpired: true, errorMessage: "x" })}
      />,
    );
    expect(expired.getByTestId("invite-preview-expired")).toBeTruthy();
    expect(expired.queryByTestId("invite-preview-error")).toBeNull();

    const error = renderWithTheme(
      <InvitePreviewPresenter {...previewProps({ errorMessage: "Full." })} />,
    );
    expect(error.getByText("Full.")).toBeTruthy();
  });

  it("hides the ready section when nothing is set up", () => {
    const { queryByTestId } = renderWithTheme(
      <InvitePreviewPresenter {...previewProps({ readyLine: "" })} />,
    );
    expect(queryByTestId("invite-preview-ready")).toBeNull();
  });
});

describe("CoachTabPresenter", () => {
  const base = {
    coaches: [],
    selected: null,
    isRefreshing: false,
    onSelect: jest.fn(),
    onRefresh: jest.fn(),
  };

  it("before anything is cached: a loader, then nothing", () => {
    const loading = renderWithTheme(<CoachTabPresenter {...base} isLoading />);
    expect(loading.getByLabelText("Loading your coach")).toBeTruthy();
    const idle = renderWithTheme(
      <CoachTabPresenter {...base} isLoading={false} />,
    );
    expect(idle.getByTestId("coach-tab-loading")).toBeTruthy();
    expect(idle.queryByLabelText("Loading your coach")).toBeNull();
  });
});

import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TrainerProgressPresenter,
  type TrainerProgressProps,
} from "../TrainerProgressPresenter";

function render(over: Partial<TrainerProgressProps> = {}) {
  const props: TrainerProgressProps = {
    trainer: null,
    pendingRequestCount: 0,
    onOpenRequests: jest.fn(),
    ...over,
  };
  return { props, ...renderWithTheme(<TrainerProgressPresenter {...props} />) };
}

describe("TrainerProgressPresenter", () => {
  it("renders the active trainer with a 'since' caption", () => {
    const { getByTestId, getByText } = render({
      trainer: {
        name: "Coach Carter",
        role: "personal_trainer",
        since: "2026-03-15T00:00:00.000Z",
      },
    });
    expect(getByTestId("you-trainer-active")).toBeTruthy();
    expect(getByText("Coach Carter")).toBeTruthy();
    expect(getByText("Personal Trainer · since Mar 2026")).toBeTruthy();
  });

  it("falls back to just the role label when there is no since date", () => {
    const { getByText } = render({
      trainer: { name: "Dr. Lee", role: "physiotherapist", since: null },
    });
    expect(getByText("Physiotherapist")).toBeTruthy();
  });

  it("shows a singular pending prompt and fires onOpenRequests", () => {
    const { props, getByTestId, getByText } = render({
      pendingRequestCount: 1,
    });
    expect(getByTestId("you-trainer-pending")).toBeTruthy();
    expect(getByText("1 pending request")).toBeTruthy();
    fireEvent.press(getByTestId("you-trainer-review"));
    expect(props.onOpenRequests).toHaveBeenCalled();
  });

  it("pluralises the pending prompt", () => {
    const { getByText } = render({ pendingRequestCount: 3 });
    expect(getByText("3 pending requests")).toBeTruthy();
  });

  it("renders both the prompt and the active card together", () => {
    const { getByTestId } = render({
      pendingRequestCount: 2,
      trainer: { name: "Coach", role: "admin", since: null },
    });
    expect(getByTestId("you-trainer-pending")).toBeTruthy();
    expect(getByTestId("you-trainer-active")).toBeTruthy();
  });
});

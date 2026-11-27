import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { CoachFormsSection } from "../CoachFormsSection";

describe("CoachFormsSection (C10p / C10r)", () => {
  it("to fill in: due, none and late cards with Fill in", () => {
    const onOpen = jest.fn();
    const utils = renderWithTheme(
      <CoachFormsSection
        toFill={[
          {
            requestId: "a",
            title: "Weekly check-in",
            due: { text: "Due tomorrow 12:00", tone: "due" },
            detail: "12 questions · about 5 min · photos",
            started: false,
          },
          {
            requestId: "b",
            title: "Weekly check-in",
            due: { text: "Late · was due Mon 12:00", tone: "late" },
            detail: "You can still send it until Sunday",
            started: true,
          },
        ]}
        done={[]}
        offlineNote={null}
        onOpen={onOpen}
      />,
    );
    expect(utils.getByText("To fill in")).toBeTruthy();
    expect(utils.getByText("2")).toBeTruthy();
    expect(utils.getByText("Late · was due Mon 12:00")).toBeTruthy();
    expect(utils.queryByTestId("coach-forms-done")).toBeNull();
    fireEvent.press(utils.getByTestId("coach-form-fill-b"));
    expect(onOpen).toHaveBeenCalledWith("b");
  });

  it("done: waiting, sent and no longer needed; the offline note", () => {
    const utils = renderWithTheme(
      <CoachFormsSection
        toFill={[]}
        done={[
          {
            requestId: "w",
            title: "Daily check-in · today",
            subtitle: "Waiting to send · saved 08:12",
            waiting: true,
            closed: false,
          },
          {
            requestId: "s",
            title: "Daily check-in · yesterday",
            subtitle: "Sent 07:58",
            waiting: false,
            closed: false,
          },
          {
            requestId: "c",
            title: "Weekly check-in · 12 Oct",
            subtitle: "This check-in is no longer needed",
            waiting: false,
            closed: true,
          },
        ]}
        offlineNote="You’re offline."
        onOpen={() => {}}
      />,
    );
    expect(utils.queryByTestId("coach-forms-to-fill")).toBeNull();
    expect(utils.getByText("Done")).toBeTruthy();
    expect(utils.getAllByText("Waiting")).toHaveLength(1);
    expect(utils.getByText("Sent 07:58")).toBeTruthy();
    expect(utils.getByText("This check-in is no longer needed")).toBeTruthy();
    expect(utils.getByTestId("coach-forms-offline")).toBeTruthy();
  });
});

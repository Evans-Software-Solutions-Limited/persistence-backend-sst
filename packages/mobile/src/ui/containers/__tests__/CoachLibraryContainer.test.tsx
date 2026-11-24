import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { useCoachLibraryTab } from "@/state/coach-library-tab";
import { CoachLibraryContainer } from "@/ui/containers/CoachLibraryContainer";
import { CoachMessagesPresenter } from "@/ui/presenters/coachForms/CoachMessagesPresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  COACH,
  makeForm,
  makeSchedule,
  setupCoachForms,
} from "./coachFormsTestKit";

const mockPush = jest.fn();
const mockParams: { segment?: string } = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
// The programmes hub has its own suite; here it only has to be what
// Library → Programmes renders.
jest.mock("@/ui/containers/CoachLibraryHubContainer", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    CoachLibraryHubContainer: (p: { embedded?: boolean }) => (
      <Text testID="programmes-hub">{p.embedded ? "embedded" : "full"}</Text>
    ),
  };
});

beforeEach(() => {
  mockPush.mockClear();
  delete mockParams.segment;
  act(() => useCoachLibraryTab.setState({ segment: "forms" }));
});

describe("CoachLibraryContainer (K shell Library tab, C10g)", () => {
  it("opens on Forms and groups the cached library offline, with N/M counts", async () => {
    const h = setupCoachForms({ online: false });
    h.storage.cacheCoachForms(COACH, {
      forms: [
        makeForm("f-week", "Weekly check-in"),
        makeForm("f-join", "Goals and health"),
        makeForm("f-draft", "Draft"),
      ],
      templates: [],
      asOf: "a",
    });
    h.storage.cacheCoachFormSchedules(COACH, [
      makeSchedule("s1", "f-week", "weekly"),
      makeSchedule("s2", "f-join", "on_join"),
    ]);
    h.storage.cacheCoachFormStats(COACH, {
      forms: [
        { formId: "f-week", reached: 11, done: 8, outstanding: 3, clients: [] },
      ],
      totals: {
        forms: 3,
        repeating: 1,
        outstanding: 3,
        onTimeRate: null,
        onTimeSample: 0,
      },
      asOf: "a",
    });
    h.api.shouldFail = true;
    const view = h.render(<CoachLibraryContainer />);
    expect(view.getByTestId("coach-library-title").props.children).toBe(
      "Forms",
    );
    expect(view.getByText("Starter forms · when they join")).toBeTruthy();
    expect(view.getByText("Repeating")).toBeTruthy();
    expect(view.getByText("Not sent yet")).toBeTruthy();
    expect(view.getByText("8/11")).toBeTruthy();
    expect(view.getByText("Sun 09:00 · 11 clients")).toBeTruthy();
    expect(view.getByTestId("forms-templates-empty")).toBeTruthy();
    await waitFor(() =>
      expect(view.getByTestId("coach-forms-offline")).toBeTruthy(),
    );

    fireEvent.press(view.getByTestId("forms-row-f-week:s1"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(app)/coach-forms/[id]",
      params: { id: "f-week" },
    });
  });

  it("reads the server when the cache is empty, and says when a 409 took the server copy", async () => {
    const h = setupCoachForms();
    h.api.coachFormsLibrary = {
      forms: [makeForm("f1", "Weekly check-in")],
      templates: [],
      asOf: "a",
    };
    h.api.coachFormSchedules = [makeSchedule("s1", "f1", "weekly")];
    h.storage.recordCoachFormConflict(COACH, "form:f1");
    const view = h.render(<CoachLibraryContainer />);
    await waitFor(() => expect(view.getByText("Weekly check-in")).toBeTruthy());
    expect(view.getByText("Edited on another device")).toBeTruthy();
    expect(h.api.coachFormsCalls).toEqual(
      expect.arrayContaining(["forms", "schedules", "stats"]),
    );
  });

  it("+ New form and a section's + Add open the editor", async () => {
    const h = setupCoachForms();
    const view = h.render(<CoachLibraryContainer />);
    await waitFor(() => expect(view.getByTestId("forms-library")).toBeTruthy());
    fireEvent.press(view.getByTestId("coach-library-new-form"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/coach-forms/edit");
    fireEvent.press(view.getByTestId("forms-section-on_join-head-add"));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: "/(app)/coach-forms/edit",
      params: { trigger: "on_join" },
    });
    fireEvent.press(view.getByTestId("forms-section-repeating-head-add"));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: "/(app)/coach-forms/edit",
      params: { trigger: "weekly" },
    });
  });

  it("Programmes is the existing hub; the others are In development", () => {
    const h = setupCoachForms();
    const view = h.render(<CoachLibraryContainer />);
    fireEvent.press(view.getByTestId("coach-library-segment-programmes"));
    expect(view.getByTestId("programmes-hub").props.children).toBe("embedded");
    expect(view.queryByTestId("coach-library-new-form")).toBeNull();
    for (const s of ["workouts", "meals", "resources"]) {
      fireEvent.press(view.getByTestId(`coach-library-segment-${s}`));
      expect(view.getByTestId(`coach-library-placeholder-${s}`)).toBeTruthy();
    }
    expect(
      view.getByText("In development (PER-122). Not in this build yet."),
    ).toBeTruthy();
  });

  it("?segment= (the old Programs tab's redirect) picks the segment", () => {
    const h = setupCoachForms();
    mockParams.segment = "programmes";
    const view = h.render(<CoachLibraryContainer />);
    expect(view.getByTestId("programmes-hub")).toBeTruthy();
    expect(view.getByTestId("coach-library-title").props.children).toBe(
      "Programmes",
    );
  });
});

describe("Messages tab", () => {
  it("is In development (PER-92)", () => {
    const view = renderWithTheme(<CoachMessagesPresenter />);
    expect(view.getByTestId("coach-messages-placeholder")).toBeTruthy();
    expect(
      view.getByText("In development (PER-92). Not in this build yet."),
    ).toBeTruthy();
  });
});

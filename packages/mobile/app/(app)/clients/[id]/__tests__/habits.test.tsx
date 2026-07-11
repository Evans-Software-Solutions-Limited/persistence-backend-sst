import { render } from "@testing-library/react-native";
import { Text } from "react-native";
import { useUserMode } from "@/state/user-mode";

const mockParams: { id?: string; name?: string } = { id: "client-9" };

jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text: T } = require("react-native");
    return <T testID="redirect">{href}</T>;
  },
  useLocalSearchParams: () => mockParams,
}));

jest.mock("@/ui/containers/HabitSetupContainer", () => ({
  HabitSetupContainer: ({
    clientId,
    clientName,
  }: {
    clientId?: string;
    clientName?: string;
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text: T } = require("react-native");
    return (
      <T testID="habit-setup-container">{`${clientId}|${clientName ?? ""}`}</T>
    );
  },
}));

void Text;

// eslint-disable-next-line import/first
import ClientHabitsScreen from "../habits";

describe("ClientHabitsScreen coach-mode gate", () => {
  afterEach(() => {
    useUserMode.setState({ mode: "athlete" });
    mockParams.id = "client-9";
    mockParams.name = undefined;
  });

  it("renders the container for the clientId in coach mode", () => {
    useUserMode.setState({ mode: "coach", isTrainerEligible: true });
    const { getByTestId, queryByTestId } = render(<ClientHabitsScreen />);
    expect(getByTestId("habit-setup-container").props.children).toBe(
      "client-9|",
    );
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("forwards the client name param so the header can be titled", () => {
    useUserMode.setState({ mode: "coach", isTrainerEligible: true });
    mockParams.name = "Alex";
    const { getByTestId } = render(<ClientHabitsScreen />);
    expect(getByTestId("habit-setup-container").props.children).toBe(
      "client-9|Alex",
    );
  });

  it("redirects home in athlete mode (no coach access)", () => {
    useUserMode.setState({ mode: "athlete" });
    const { getByTestId, queryByTestId } = render(<ClientHabitsScreen />);
    expect(getByTestId("redirect").props.children).toBe("/(app)/(tabs)");
    expect(queryByTestId("habit-setup-container")).toBeNull();
  });

  it("redirects home when the id is missing", () => {
    useUserMode.setState({ mode: "coach", isTrainerEligible: true });
    mockParams.id = undefined;
    const { getByTestId } = render(<ClientHabitsScreen />);
    expect(getByTestId("redirect").props.children).toBe("/(app)/(tabs)");
  });
});

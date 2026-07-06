import { render } from "@testing-library/react-native";
import { Text } from "react-native";
import { useUserMode } from "@/state/user-mode";

const mockParams: { id?: string } = { id: "client-9" };

jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text: T } = require("react-native");
    return <T testID="redirect">{href}</T>;
  },
  useLocalSearchParams: () => mockParams,
}));

jest.mock("@/ui/containers/ClientDetailContainer", () => ({
  ClientDetailContainer: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text: T } = require("react-native");
    return <T testID="client-detail-container">detail</T>;
  },
}));

void Text;

// eslint-disable-next-line import/first
import ClientDetailScreen from "../index";

describe("ClientDetailScreen coach-mode gate", () => {
  afterEach(() => {
    useUserMode.setState({ mode: "athlete" });
    mockParams.id = "client-9";
  });

  it("renders the container in coach mode", () => {
    useUserMode.setState({ mode: "coach", isTrainerEligible: true });
    const { getByTestId, queryByTestId } = render(<ClientDetailScreen />);
    expect(getByTestId("client-detail-container")).toBeTruthy();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("redirects home in athlete mode", () => {
    useUserMode.setState({ mode: "athlete" });
    const { getByTestId, queryByTestId } = render(<ClientDetailScreen />);
    expect(getByTestId("redirect").props.children).toBe("/(app)/(tabs)");
    expect(queryByTestId("client-detail-container")).toBeNull();
  });

  it("redirects home when the id is missing", () => {
    useUserMode.setState({ mode: "coach", isTrainerEligible: true });
    mockParams.id = undefined;
    const { getByTestId } = render(<ClientDetailScreen />);
    expect(getByTestId("redirect").props.children).toBe("/(app)/(tabs)");
  });
});

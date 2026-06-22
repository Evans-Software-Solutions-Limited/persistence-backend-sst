import { render } from "@testing-library/react-native";
import { Text } from "react-native";
import { useUserMode } from "@/state/user-mode";
import YouTab from "../you";

jest.mock("@/ui/containers/YouContainer", () => ({
  YouContainer: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require("react-native");
    return <Text testID="athlete-you">athlete</Text>;
  },
}));
jest.mock("@/ui/containers/CoachYouContainer", () => ({
  CoachYouContainer: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text } = require("react-native");
    return <Text testID="coach-you">coach</Text>;
  },
}));

void Text;

describe("YouTab mode branch", () => {
  afterEach(() => {
    useUserMode.setState({ mode: "athlete" });
  });

  it("renders the athlete YouContainer in athlete mode", () => {
    useUserMode.setState({ mode: "athlete" });
    const { getByTestId, queryByTestId } = render(<YouTab />);
    expect(getByTestId("athlete-you")).toBeTruthy();
    expect(queryByTestId("coach-you")).toBeNull();
  });

  it("renders the CoachYouContainer in coach mode", () => {
    useUserMode.setState({ mode: "coach", isTrainerEligible: true });
    const { getByTestId, queryByTestId } = render(<YouTab />);
    expect(getByTestId("coach-you")).toBeTruthy();
    expect(queryByTestId("athlete-you")).toBeNull();
  });
});

import { render } from "@testing-library/react-native";
import BodyFatHistoryScreen from "../body-fat-history";

const mockBodyHistory = jest.fn((_props: { metric: string }) => null);

jest.mock("@/ui/containers/BodyHistoryContainer", () => ({
  BodyHistoryContainer: (props: { metric: string }) => mockBodyHistory(props),
}));

describe("BodyFatHistoryScreen", () => {
  it("opens the dedicated history container with body-fat context", () => {
    render(<BodyFatHistoryScreen />);
    expect(mockBodyHistory).toHaveBeenLastCalledWith({ metric: "bodyFat" });
  });
});

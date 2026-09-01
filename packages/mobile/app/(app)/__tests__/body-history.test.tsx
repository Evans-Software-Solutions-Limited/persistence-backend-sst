import { render } from "@testing-library/react-native";
import BodyHistoryScreen from "../body-history";

type BodyHistoryContainerProps = { metric?: "weight" | "bodyFat" };
const mockSearchParams: { metric?: string } = {};
const mockBodyHistory = jest.fn((_props: BodyHistoryContainerProps) => null);

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock("@/ui/containers/BodyHistoryContainer", () => ({
  BodyHistoryContainer: (props: BodyHistoryContainerProps) =>
    mockBodyHistory(props),
}));

describe("BodyHistoryScreen compatibility route", () => {
  beforeEach(() => {
    delete mockSearchParams.metric;
    mockBodyHistory.mockClear();
  });

  it("defaults legacy links to weight history", () => {
    render(<BodyHistoryScreen />);
    expect(mockBodyHistory).toHaveBeenLastCalledWith({ metric: "weight" });
  });

  it("preserves an explicit body-fat route context", () => {
    mockSearchParams.metric = "bodyFat";
    render(<BodyHistoryScreen />);
    expect(mockBodyHistory).toHaveBeenLastCalledWith({ metric: "bodyFat" });
  });

  it("fails closed to weight for unknown metric values", () => {
    mockSearchParams.metric = "event-object";
    render(<BodyHistoryScreen />);
    expect(mockBodyHistory).toHaveBeenLastCalledWith({ metric: "weight" });
  });
});

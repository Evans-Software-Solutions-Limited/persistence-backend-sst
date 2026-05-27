import { fireEvent, render } from "@testing-library/react-native";
import { Pressable, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { HelpCenterPresenter } from "@/ui/presenters/HelpCenterPresenter";
import { HelpCenterContainer } from "../HelpCenterContainer";

jest.mock("@/ui/presenters/HelpCenterPresenter");
const MockPresenter = jest.mocked(HelpCenterPresenter);

MockPresenter.mockImplementation((props) => (
  <View testID="help-center-presenter-stub">
    <Pressable testID="stub-back" onPress={() => props.onBack()} />
    <Pressable
      testID="stub-contact-support"
      onPress={() => props.onContactSupport()}
    />
  </View>
));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

function wrap(ui: React.ReactElement) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, left: 0, right: 0, bottom: 34 },
      }}
    >
      {ui}
    </SafeAreaProvider>
  );
}

describe("HelpCenterContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBack.mockReset();
    mockPush.mockReset();
  });

  it("renders the presenter", () => {
    const { getByTestId } = render(wrap(<HelpCenterContainer />));
    expect(getByTestId("help-center-presenter-stub")).toBeTruthy();
  });

  it("routes back when the presenter fires onBack", () => {
    const { getByTestId } = render(wrap(<HelpCenterContainer />));
    fireEvent.press(getByTestId("stub-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("pushes the contact route when onContactSupport fires", () => {
    const { getByTestId } = render(wrap(<HelpCenterContainer />));
    fireEvent.press(getByTestId("stub-contact-support"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/contact");
  });
});

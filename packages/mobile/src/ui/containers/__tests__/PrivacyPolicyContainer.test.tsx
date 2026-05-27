import { fireEvent, render } from "@testing-library/react-native";
import { Pressable, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PrivacyPolicyPresenter } from "@/ui/presenters/PrivacyPolicyPresenter";
import { PrivacyPolicyContainer } from "../PrivacyPolicyContainer";

jest.mock("@/ui/presenters/PrivacyPolicyPresenter");
const MockPresenter = jest.mocked(PrivacyPolicyPresenter);

MockPresenter.mockImplementation((props) => (
  <View testID="privacy-policy-presenter-stub">
    <Pressable
      testID="stub-back"
      onPress={() => {
        props.onBack();
      }}
    />
  </View>
));

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
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

describe("PrivacyPolicyContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBack.mockReset();
  });

  it("renders the presenter", () => {
    const { getByTestId } = render(wrap(<PrivacyPolicyContainer />));
    expect(getByTestId("privacy-policy-presenter-stub")).toBeTruthy();
  });

  it("routes back when the presenter fires onBack", () => {
    const { getByTestId } = render(wrap(<PrivacyPolicyContainer />));
    fireEvent.press(getByTestId("stub-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
